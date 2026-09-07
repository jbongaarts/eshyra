import { randomUUID } from 'node:crypto';
import { resolveCampaignPosition } from '../campaign/campaignPosition.js';
import { formatCampaignPosition } from '../campaign/campaignRules.js';
import type { CharacterChronicleStore } from '../character/characterChronicle.js';
import type {
  CandidateDisposition,
  ModelCallTrace,
  SessionDebugSink,
  ToolCallDisposition,
  TurnCandidateDispositionEvent,
} from '../debug/sessionDebug.js';
import {
  recordTurnFailureDiagnostic,
  sanitizeDiagnosticMessage,
} from '../memory/turnFailureDiagnostic.js';
import type {
  TraceJsonValue,
  TurnTraceConsentScope,
} from '../memory/turnTrace.js';
import { recordTurnTrace } from '../memory/turnTrace.js';
import type { ModelClient } from '../model/client.js';
import { ModelClientError, ModelRateLimitError } from '../model/client.js';
import type {
  AuditRetryCause,
  ToolUsageRecord,
  TurnAuditRecord,
  TurnDiagnosticsSink,
  TurnOutcome,
} from '../model/usage.js';
import type { Db } from '../persistence/db.js';
import { resolveActingCharacterId } from '../state/activeCharacter.js';
import type { CampaignRulesPackResolver } from '../state/campaignRecordLookup.js';
import {
  classifyAuditPresentationRepair,
  classifyAuditRetryCause,
} from './auditRetryDiagnostics.js';
import type { AdventureModuleResolver } from './contextAssembler.js';
import { assembleContext, renderContextMessage } from './contextAssembler.js';
import { appendPlayerVisibleRollLedger } from './playerVisibleRollLedger.js';
import { buildSystemPrompt, type ToolProtocol } from './protocol.js';
import { createSeededRng } from './rng.js';
import type { ToolContext, ToolRegistry } from './tools.js';
import {
  AuditError,
  type AuditVerdict,
  formatMissingCall,
  type TurnAuditor,
} from './turnAuditor.js';
import {
  type ExecutedToolCall,
  OrchestratorError,
  runModelLoop,
  type ToolSpan,
} from './turnLoop.js';
import { summarizeClosedScenes } from './turnSceneSummary.js';
import {
  deriveTraceFields,
  extractClosedSceneIds,
} from './turnTraceProjection.js';
import { appendTurnTranscript } from './turnTranscript.js';

/**
 * Orchestrator turn coordinator (E5).
 *
 * `runTurn` is the integrating shell. It owns the per-turn SAVEPOINT and the
 * five distinct phases of a turn — each phase lives in its own module:
 *
 *   1. assemble bounded context             → contextAssembler
 *   2. run the model/tool round loop        → turnLoop (runModelLoop)
 *   3. summarize any scenes the model closed → turnSceneSummary
 *   4. append player + DM to the scene log  → turnTranscript
 *   5. record the structured turn trace     → turnTraceProjection + memory/turnTrace
 *
 * The whole turn runs inside a SQLite SAVEPOINT: any failure — model SDK
 * error, exhausted tool budget, validation rejection — rolls every write
 * back, leaving pre-turn state intact. Narration that is not a tool call
 * never mutates canon; only the tool layer writes.
 */

export type { ExecutedToolCall };
export { OrchestratorError };

const TURN_SAVEPOINT = 'eshyra_turn';
const ATTEMPT_SAVEPOINT = 'eshyra_turn_attempt';
const DEFAULT_MAX_TOOL_ROUNDS = 8;
const DEFAULT_MAX_AUDITED_ATTEMPTS = 3;

export interface RunTurnDeps {
  db: Db;
  model: ModelClient;
  registry: ToolRegistry;
  /** Resolves exact campaign-bound base/add-on packs not bundled in core. */
  resolveRulesPack?: CampaignRulesPackResolver;
  /**
   * Optional mechanics-audit gate (eshyra-oobh). When provided, every candidate
   * DM response is audited before it is shown or persisted: a candidate that
   * asserts a mechanical outcome without the executed tool is rejected, retried
   * once with a corrective instruction, then fails the turn. When omitted,
   * auditing is skipped (the legacy/test path).
   */
  auditor?: TurnAuditor;
  /**
   * Optional debug sink (eshyra-oobh) used to log audit verdicts and the action
   * the orchestrator took. The model-call debug events themselves are emitted by
   * the model client adapters; this records the orchestrator-level decision.
   */
  debug?: SessionDebugSink;
  /**
   * Optional per-turn timing diagnostics sink (eshyra-17ng). Receives a tool
   * span for every executed tool and one outcome record per turn, so a slow turn
   * can be decomposed into model / audit / retry / tool time. Best-effort:
   * sink failures are swallowed and never destabilize a turn. Model-call timing
   * is recorded separately by the {@link ModelUsageTracker} wrapping `model`.
   */
  diagnostics?: TurnDiagnosticsSink;
  /**
   * Optional resolver that binds a campaign's active adventure-run module id to
   * its immutable module source (eshyra-eh54.5). When provided, the bounded
   * context assembler includes a per-active-run adventure module slice in the
   * DM context. When omitted, no module context is fed and campaigns without
   * adventure runs are unaffected. The campaign→module-source wiring (loading
   * the module pack from disk) is the caller's concern.
   */
  resolveAdventureModule?: AdventureModuleResolver;
  /**
   * Optional registry-backed chronicle store. When supplied, the context
   * assembler renders portable records for the acting registry-linked character
   * as character memory, separate from campaign canon.
   */
  characterChronicle?: CharacterChronicleStore;
}

export interface RunTurnInput {
  campaignId: string;
  sessionId: string;
  turnId: string;
  playerInput: string;
  /**
   * PC acting on this turn. Character-scoped tools target this PC by default
   * and its sheet is the rendered turn subject. Defaults to the active
   * character (`meta.active_character_id`) when omitted.
   */
  actingCharacterId?: string;
  /** Seed for this turn's code-owned RNG — makes the turn reproducible. */
  seed: number;
  /** ISO timestamp stamped on every write this turn. */
  at: string;
  consentScope?: TurnTraceConsentScope;
  promptProfile?: string;
  recentSessionLimit?: number;
  maxToolRounds?: number;
  /**
   * Tool transport the DM system prompt should describe (eshyra-eznk). Defaults
   * to `native` — released gameplay runs on a ModelClient with a native tool
   * channel (the Anthropic adapter), so the prompt must not instruct the model
   * to emit fenced ```tool_call blocks. Set `fenced` only for a legacy/test
   * model client that has no native tool channel. This is transport-neutral
   * prompt shaping — the turn loop still parses both transports regardless.
   */
  toolProtocol?: ToolProtocol;
}

export interface RunTurnResult {
  ok: boolean;
  turnId: string;
  narration: string;
  toolCalls: ExecutedToolCall[];
  /** Scene the turn was logged into, if any was open at turn end. */
  sceneId: string | undefined;
  modelRounds: number;
  error: string | undefined;
  /** True when the turn failed because the provider rate-limited the request. */
  isRateLimit: boolean;
  /** Provider-reported retry delay in seconds, when available. */
  retryAfterSeconds?: number;
}

/** Developer-facing message for a turn that failed the mechanics audit twice. */
function formatAuditFailure(verdict: AuditVerdict): string {
  // Prefer the target-specific missing calls (eshyra-znzn) so the failure
  // message names which record/intent was missing, not just the tool — a turn
  // can execute `lookup_rules` and still be rejected for missing a per-record
  // lookup, which a tool-name-only message makes look self-contradictory.
  const missing =
    verdict.missingRequiredCalls.length > 0
      ? verdict.missingRequiredCalls.map(formatMissingCall).join(', ')
      : verdict.missingRequiredTools.length > 0
        ? verdict.missingRequiredTools.join(', ')
        : '(none)';
  const disallowed =
    verdict.disallowedToolCalls.length > 0
      ? verdict.disallowedToolCalls.join(', ')
      : '(none)';
  return `turn rejected by mechanics audit after retry: missing required tool(s) [${missing}], disallowed tool call(s) [${disallowed}] — ${verdict.reason || 'no reason given'}`;
}

function auditRequirementKeys(verdict: AuditVerdict): string[] {
  const keys = [
    ...verdict.missingRequiredCalls.map(
      (call) => `missing:${call.tool}:${call.target ?? ''}`,
    ),
    ...verdict.disallowedToolCalls.map((tool) => `disallowed:${tool}`),
  ];
  if (keys.length === 0 && verdict.reason.length > 0) {
    keys.push(`reason:${verdict.reason}`);
  }
  return keys;
}

function mergeMissingCalls(
  left: readonly AuditVerdict['missingRequiredCalls'][number][],
  right: readonly AuditVerdict['missingRequiredCalls'][number][],
): AuditVerdict['missingRequiredCalls'] {
  const merged: AuditVerdict['missingRequiredCalls'][number][] = [];
  const seen = new Set<string>();
  for (const call of [...left, ...right]) {
    const key = `${call.tool}:${call.target ?? ''}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(call);
  }
  return merged;
}

function mergeAuditVerdicts(
  left: AuditVerdict | undefined,
  right: AuditVerdict,
): AuditVerdict {
  if (left === undefined) {
    return right;
  }
  const missingRequiredCalls = mergeMissingCalls(
    left.missingRequiredCalls,
    right.missingRequiredCalls,
  );
  const missingRequiredTools = [
    ...new Set(missingRequiredCalls.map((call) => call.tool)),
  ];
  const disallowedToolCalls = [
    ...new Set([...left.disallowedToolCalls, ...right.disallowedToolCalls]),
  ];
  return {
    verdict: 'reject',
    missingRequiredTools,
    missingRequiredCalls,
    disallowedToolCalls,
    reason: [left.reason, right.reason]
      .filter((reason) => reason.length > 0)
      .join(' | '),
    repairInstruction: [left.repairInstruction, right.repairInstruction]
      .filter((instruction) => instruction.length > 0)
      .join('\n'),
  };
}

function shouldRetryAuditRejection(input: {
  attempt: number;
  requirementKeys: readonly string[];
  seenRequirementKeys: ReadonlySet<string>;
}): boolean {
  if (input.attempt >= DEFAULT_MAX_AUDITED_ATTEMPTS) {
    return false;
  }
  if (input.attempt === 1) {
    return true;
  }
  return input.requirementKeys.some(
    (key) => !input.seenRequirementKeys.has(key),
  );
}

/** Corrective note appended to the context for a single audited retry. */
function formatCorrectiveNote(
  verdict: AuditVerdict,
  toolNames: readonly string[],
): string {
  // A candidate may be rejected for asserting a mechanical outcome without the
  // owning tool (missingRequiredTools) and/or for calling an explicit-action-only
  // tool with no explicit player action (disallowedToolCalls). The corrective
  // note addresses whichever applies so the retry knows what to change.
  const lines: string[] = [
    '## Correction Required',
    'The previous candidate was rejected. All tool calls from that rejected',
    'candidate were rolled back and did not apply. Recreate the full intended',
    'accepted outcome from scratch: replay every required tool call with the',
    'correct quantities and targets; do not merely patch the previous answer.',
    'This note is cumulative across rejected attempts; satisfy every requirement',
    'listed here, even if a later rejection exposed it after an earlier repair.',
    'Query module canon with world_query before resolving existing NPCs,',
    'locations, or lore. Record consequential new lore with record_world_fact',
    'before asserting it as established. Use recent scene evidence only for',
    'immediate same-scene continuity, and avoid unsupported exact numbers unless',
    'they are sourced by module canon, campaign state, overlay lore, scene',
    'evidence, or a successful current-turn tool call.',
  ];
  if (verdict.disallowedToolCalls.length > 0) {
    const disallowed = verdict.disallowedToolCalls.join(', ');
    lines.push(
      'Your previous response called a tool that requires explicit player action',
      'without the player taking that action, so it was rejected and NOT shown to',
      `the player. Do NOT call these tools to answer a state query: ${disallowed}.`,
      'Report the current state as recorded and offer the player a choice instead',
      'of mutating state to answer their question.',
    );
  }
  if (
    verdict.missingRequiredTools.length > 0 ||
    verdict.disallowedToolCalls.length === 0
  ) {
    // Prefer the target-specific missing calls (eshyra-znzn): a retry told to
    // "call lookup_rules" when it already did is useless, but "call lookup_rules
    // for chain mail, shield, longsword" is actionable.
    const calls =
      verdict.missingRequiredCalls.length > 0
        ? verdict.missingRequiredCalls.map(formatMissingCall).join(', ')
        : verdict.missingRequiredTools.length > 0
          ? verdict.missingRequiredTools.join(', ')
          : toolNames.join(', ');
    lines.push(
      'Your previous response asserted a mechanical outcome without calling the',
      'tool that owns it, so it was rejected and NOT shown to the player.',
      `Use your native tool interface to call: ${calls}. Do not state any dice`,
      'result, state change, or rules fact unless a tool produced it this turn.',
    );
  }
  if (verdict.repairInstruction) {
    lines.push(verdict.repairInstruction);
  }
  return lines.join('\n');
}

/** Best-effort audit-verdict debug; a sink failure must never break a turn. */
function recordAuditDebug(
  sink: SessionDebugSink | undefined,
  event: Parameters<NonNullable<SessionDebugSink['recordAudit']>>[0],
): void {
  if (sink?.recordAudit === undefined) {
    return;
  }
  try {
    sink.recordAudit(event);
  } catch {
    // Diagnostics must never destabilize a turn.
  }
}

/** Project executed calls into the structural disposition shape (eshyra-dwkm). */
function toToolDispositions(
  calls: readonly ExecutedToolCall[],
): ToolCallDisposition[] {
  return calls.map((c) => ({
    tool: c.tool,
    mutates: c.mutates,
    ok: c.result.ok,
  }));
}

/**
 * Best-effort candidate-disposition debug (eshyra-dwkm). Records whether a
 * candidate's staged tool effects were committed or rolled back, so the
 * staged → committed/rolled-back transition is explicit in the session log. A
 * sink failure must never break a turn.
 */
function recordDispositionDebug(
  sink: SessionDebugSink | undefined,
  trace: ModelCallTrace,
  attempt: number,
  disposition: CandidateDisposition,
  reason: TurnCandidateDispositionEvent['reason'],
  calls: readonly ExecutedToolCall[],
): void {
  if (sink?.recordCandidateDisposition === undefined) {
    return;
  }
  const toolCalls = toToolDispositions(calls);
  try {
    sink.recordCandidateDisposition({
      kind: 'turn_candidate_disposition',
      trace,
      attempt,
      disposition,
      reason,
      toolCalls,
      mutatingToolCount: toolCalls.filter((c) => c.mutates).length,
    });
  } catch {
    // Diagnostics must never destabilize a turn.
  }
}

/**
 * Classify a thrown turn failure into a structural {@link TurnOutcome}
 * (eshyra-17ng). A provider rate/session limit wins regardless of which model
 * call raised it; the audit phase distinguishes an auditor model/parse failure
 * (`audit_error`) from exhausted-retry rejection (`failed_after_reject`); other
 * provider failures are `provider_error`; everything else (rounds exhausted,
 * empty narration, tool/phase exception) is `failed_before_apply`.
 */
function classifyFailureOutcome(error: unknown, phase: string): TurnOutcome {
  if (error instanceof ModelRateLimitError) {
    return 'provider_limit';
  }
  if (error instanceof AuditError) {
    return 'audit_error';
  }
  if (phase === 'mechanics_audit') {
    if (error instanceof OrchestratorError) {
      return 'failed_after_reject';
    }
    if (error instanceof ModelClientError) {
      return 'provider_error';
    }
    return 'audit_error';
  }
  if (error instanceof ModelClientError) {
    return 'provider_error';
  }
  return 'failed_before_apply';
}

/** Best-effort tool-span recording; a sink failure must never break a turn. */
function recordToolUsage(
  sink: TurnDiagnosticsSink | undefined,
  entry: ToolUsageRecord,
): void {
  if (sink === undefined) {
    return;
  }
  try {
    sink.recordTool(entry);
  } catch {
    // Diagnostics must never destabilize a turn.
  }
}

/** Best-effort audit-retry recording; a sink failure must never break a turn. */
function recordAuditUsage(
  sink: TurnDiagnosticsSink | undefined,
  entry: TurnAuditRecord,
): void {
  if (sink === undefined) {
    return;
  }
  try {
    sink.recordAudit(entry);
  } catch {
    // Diagnostics must never destabilize a turn.
  }
}

interface RetryDiagnosticsSummary {
  readonly auditorCallCount: number;
  readonly retryCauses: readonly AuditRetryCause[];
  readonly toolsRerunDuringRetry: readonly string[];
}

interface TurnOutcomeDiagnostics extends RetryDiagnosticsSummary {
  readonly primaryDmCandidateCount: number;
}

function repeatedAcceptedRetryTools(
  acceptedToolCalls: readonly ExecutedToolCall[],
  rejectedAttemptToolNames: ReadonlySet<string>,
): readonly string[] {
  return [
    ...new Set(
      acceptedToolCalls
        .map((call) => call.tool)
        .filter((tool) => rejectedAttemptToolNames.has(tool)),
    ),
  ].sort();
}

/** Best-effort turn-outcome recording; a sink failure must never break a turn. */
function recordTurnOutcome(
  sink: TurnDiagnosticsSink | undefined,
  input: RunTurnInput,
  at: string,
  outcome: TurnOutcome,
  attempts: number,
  modelRounds: number,
  elapsedMs: number,
  reason: string | null,
  diagnostics: TurnOutcomeDiagnostics,
): void {
  if (sink === undefined) {
    return;
  }
  const primaryDmRetryCount = Math.max(
    0,
    diagnostics.primaryDmCandidateCount - 1,
  );
  try {
    sink.recordOutcome({
      id: randomUUID(),
      at,
      campaignId: input.campaignId,
      sessionId: input.sessionId,
      turnId: input.turnId,
      outcome,
      attempts,
      modelRounds,
      elapsedMs,
      reason,
      auditorCallCount: diagnostics.auditorCallCount,
      primaryDmCandidateCount: diagnostics.primaryDmCandidateCount,
      primaryDmCallCount: modelRounds,
      primaryDmRetryCount,
      retryCauses: diagnostics.retryCauses,
      retrySucceeded: primaryDmRetryCount === 0 ? null : outcome === 'accepted',
      toolsRerunDuringRetry: diagnostics.toolsRerunDuringRetry,
    });
  } catch {
    // Diagnostics must never destabilize a turn.
  }
}

export async function runTurn(
  deps: RunTurnDeps,
  input: RunTurnInput,
): Promise<RunTurnResult> {
  const { db, model, registry } = deps;
  const maxToolRounds = input.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS;
  const toolCtx: ToolContext = {
    db,
    rng: createSeededRng(input.seed),
    campaignId: input.campaignId,
    sessionId: input.sessionId,
    turnId: input.turnId,
    at: input.at,
    resolveAdventureModule: deps.resolveAdventureModule,
    resolveRulesPack: deps.resolveRulesPack,
  };

  // Tracked here (not inside runModelLoop) so the failure path can still
  // report the round count the turn reached before it threw.
  let rounds = 0;
  // Wall-clock start for the per-turn outcome timing (eshyra-17ng).
  const turnStartMs = Date.now();
  let phase = 'resolve_acting_character';
  // Last candidate attempt reached, so the catch path can label the turn-error
  // rollback disposition with the attempt it aborted on (eshyra-dwkm).
  let dispositionAttempt = 0;
  let auditorCallCount = 0;
  const retryCauses: AuditRetryCause[] = [];
  const rejectedAttemptToolNames = new Set<string>();
  let toolsRerunDuringRetry: readonly string[] = [];

  db.exec(`SAVEPOINT ${TURN_SAVEPOINT}`);
  try {
    // Resolve inside the turn savepoint. A new failed attempt must not leave a
    // chronology hole behind, while INSERT OR IGNORE still preserves the
    // durable position of an intentional replay.
    const campaignPosition = resolveCampaignPosition(db, {
      campaignId: input.campaignId,
      sessionId: input.sessionId,
      turnId: input.turnId,
    });
    // Resolve and validate the acting PC before any context assembly, tool
    // execution, or trace write. A non-PC or missing actingCharacterId throws
    // here, so the turn rolls back as ok:false with nothing persisted.
    const actingCharacterId = resolveActingCharacterId(
      db,
      input.actingCharacterId,
    );
    toolCtx.actingCharacterId = actingCharacterId;

    phase = 'assemble_context';
    const assembled = assembleContext({
      db,
      campaignId: input.campaignId,
      sessionId: input.sessionId,
      playerInput: input.playerInput,
      recentSessionLimit: input.recentSessionLimit,
      actingCharacterId,
      resolveAdventureModule: deps.resolveAdventureModule,
      characterChronicle: deps.characterChronicle,
      campaignPosition: formatCampaignPosition(campaignPosition),
      resolveRulesPack: deps.resolveRulesPack,
    });

    phase = 'model_loop';
    const system = buildSystemPrompt(registry, {
      toolProtocol: input.toolProtocol ?? 'native',
    });
    const baseUserMessage = renderContextMessage(assembled);
    const auditTrace = {
      campaignId: input.campaignId,
      sessionId: input.sessionId,
      turnId: input.turnId,
    };
    const dispositionTrace: ModelCallTrace = {
      ...auditTrace,
      purpose: 'turn_candidate_disposition',
    };
    // Each candidate runs inside its OWN savepoint so a rejected attempt's tool
    // mutations are rolled back before a retry — only the accepted candidate's
    // writes survive. The auditor gate (eshyra-oobh) sits between producing a
    // candidate and accepting it; with no auditor wired the first candidate is
    // accepted unconditionally (the legacy/test path). Audited turns get one
    // normal repair and one bounded extra repair only when the retry exposes a
    // new requirement class.
    const maxAttempts = deps.auditor ? DEFAULT_MAX_AUDITED_ATTEMPTS : 1;
    let narration = '';
    let toolCalls: ExecutedToolCall[] = [];
    let correctiveNote: string | undefined;
    let cumulativeVerdict: AuditVerdict | undefined;
    const seenRequirementKeys = new Set<string>();
    for (let attempt = 1; ; attempt += 1) {
      dispositionAttempt = attempt;
      db.exec(`SAVEPOINT ${ATTEMPT_SAVEPOINT}`);
      const candidate = await runModelLoop({
        model,
        registry,
        toolCtx,
        system,
        initialUserMessage:
          correctiveNote === undefined
            ? baseUserMessage
            : `${baseUserMessage}\n\n${correctiveNote}`,
        maxToolRounds,
        onRoundStart: () => {
          rounds += 1;
        },
        trace: {
          ...auditTrace,
          purpose: 'turn_model_loop',
          attempt,
        },
        ...(deps.diagnostics
          ? {
              onToolSpan: (span: ToolSpan) =>
                recordToolUsage(deps.diagnostics, {
                  id: randomUUID(),
                  at: input.at,
                  campaignId: input.campaignId,
                  sessionId: input.sessionId,
                  turnId: input.turnId,
                  attempt,
                  round: span.round,
                  tool: span.tool,
                  source: span.source,
                  mutates: span.mutates,
                  ok: span.ok,
                  errorCode: span.errorCode,
                  elapsedMs: span.elapsedMs,
                }),
            }
          : {}),
      });
      const candidateNarration = appendPlayerVisibleRollLedger(
        candidate.narration,
        candidate.toolCalls,
      );

      if (deps.auditor === undefined) {
        db.exec(`RELEASE ${ATTEMPT_SAVEPOINT}`);
        recordDispositionDebug(
          deps.debug,
          dispositionTrace,
          attempt,
          'committed',
          'accepted',
          candidate.toolCalls,
        );
        narration = candidateNarration;
        toolCalls = candidate.toolCalls;
        break;
      }

      phase = 'mechanics_audit';
      auditorCallCount += 1;
      const verdict = await deps.auditor.audit({
        playerInput: input.playerInput,
        candidateResponse: candidateNarration,
        providedToolNames: registry.list(),
        executedToolCalls: candidate.toolCalls,
        campaignRules: assembled.campaignRules,
        currentStateSnapshot: assembled.state,
        recentSceneEvidence: assembled.recentSceneEvidence,
        requiresExplicitActionTools: registry.listRequiresExplicitAction(),
        trace: {
          ...auditTrace,
          extra: { purpose: 'turn_audit', attempt: String(attempt) },
        },
      });
      const presentationRepairCause = classifyAuditPresentationRepair(
        verdict,
        candidate.toolCalls,
      );
      const accepted =
        verdict.verdict === 'accept' || presentationRepairCause !== null;
      const requirementKeys = auditRequirementKeys(verdict);
      const retry = accepted
        ? false
        : shouldRetryAuditRejection({
            attempt,
            requirementKeys,
            seenRequirementKeys,
          });
      if (!accepted) {
        cumulativeVerdict = mergeAuditVerdicts(cumulativeVerdict, verdict);
        for (const key of requirementKeys) {
          seenRequirementKeys.add(key);
        }
      }
      const action: 'accept' | 'repair' | 'retry' | 'fail' =
        verdict.verdict === 'accept'
          ? 'accept'
          : presentationRepairCause !== null
            ? 'repair'
            : retry && attempt < maxAttempts
              ? 'retry'
              : 'fail';
      const retryCause =
        presentationRepairCause ??
        classifyAuditRetryCause(verdict, candidate.toolCalls);
      if (retryCause !== null) {
        retryCauses.push(retryCause);
      }
      recordAuditDebug(deps.debug, {
        kind: 'turn_audit',
        trace: { ...auditTrace, purpose: 'turn_audit' },
        attempt,
        verdict: verdict.verdict,
        missingRequiredTools: verdict.missingRequiredTools,
        missingRequiredCalls: verdict.missingRequiredCalls,
        cumulativeMissingRequiredTools:
          cumulativeVerdict?.missingRequiredTools ?? [],
        cumulativeMissingRequiredCalls:
          cumulativeVerdict?.missingRequiredCalls ?? [],
        disallowedToolCalls: verdict.disallowedToolCalls,
        cumulativeDisallowedToolCalls:
          cumulativeVerdict?.disallowedToolCalls ?? [],
        executedToolNames: candidate.toolCalls.map((c) => c.tool),
        action,
        auditorModel: deps.auditor.modelId ?? 'unknown',
      });
      recordAuditUsage(deps.diagnostics, {
        id: randomUUID(),
        at: input.at,
        campaignId: input.campaignId,
        sessionId: input.sessionId,
        turnId: input.turnId,
        attempt,
        verdict: verdict.verdict,
        action,
        retryCause,
        missingRequiredTools: verdict.missingRequiredTools,
        disallowedToolCalls: verdict.disallowedToolCalls,
        executedToolNames: candidate.toolCalls.map((call) => call.tool),
        failedToolNames: candidate.toolCalls
          .filter((call) => !call.result.ok)
          .map((call) => call.tool),
        mutatingToolCount: candidate.toolCalls.filter((call) => call.mutates)
          .length,
        auditorModel: deps.auditor.modelId ?? null,
      });

      if (accepted) {
        db.exec(`RELEASE ${ATTEMPT_SAVEPOINT}`);
        recordDispositionDebug(
          deps.debug,
          dispositionTrace,
          attempt,
          'committed',
          'accepted',
          candidate.toolCalls,
        );
        narration = candidateNarration;
        toolCalls = candidate.toolCalls;
        toolsRerunDuringRetry = repeatedAcceptedRetryTools(
          candidate.toolCalls,
          rejectedAttemptToolNames,
        );
        break;
      }

      // Rejected: discard this candidate's tool mutations so nothing it wrote can
      // survive, then either retry with a corrective note or fail the turn.
      db.exec(`ROLLBACK TO ${ATTEMPT_SAVEPOINT}`);
      db.exec(`RELEASE ${ATTEMPT_SAVEPOINT}`);
      for (const call of candidate.toolCalls) {
        rejectedAttemptToolNames.add(call.tool);
      }
      recordDispositionDebug(
        deps.debug,
        dispositionTrace,
        attempt,
        'rolled_back',
        'audit_rejected',
        candidate.toolCalls,
      );
      if (action === 'fail') {
        throw new OrchestratorError(
          formatAuditFailure(cumulativeVerdict ?? verdict),
        );
      }
      phase = 'model_loop';
      correctiveNote = formatCorrectiveNote(
        cumulativeVerdict ?? verdict,
        registry.list(),
      );
    }

    phase = 'scene_summary';
    const closedSceneIds = extractClosedSceneIds(toolCalls);
    summarizeClosedScenes({
      db,
      campaignId: input.campaignId,
      sessionId: input.sessionId,
      sceneIds: closedSceneIds,
      at: input.at,
    });

    phase = 'transcript';
    const activeScene = appendTurnTranscript({
      db,
      campaignId: input.campaignId,
      sessionId: input.sessionId,
      turnId: input.turnId,
      playerInput: input.playerInput,
      narration,
      at: input.at,
    });

    phase = 'turn_trace';
    recordTurnTrace(db, {
      campaignId: input.campaignId,
      sessionId: input.sessionId,
      turnId: input.turnId,
      consentScope: input.consentScope ?? 'private',
      playerInput: input.playerInput,
      actingCharacterId,
      retrievedContext: [renderContextMessage(assembled)],
      promptProfile: input.promptProfile ?? 'default',
      modelOutput: narration,
      toolCalls: toolCalls.map(
        (c): TraceJsonValue => ({
          tool: c.tool,
          args: (c.args ?? null) as TraceJsonValue,
          result: c.result as unknown as TraceJsonValue,
          source: c.source,
          // Explicit canon-write classification of each committed call (eshyra-dwkm).
          mutates: c.mutates,
          ...(c.callId ? { callId: c.callId } : {}),
          ...(c.stopReason ? { stopReason: c.stopReason } : {}),
        }),
      ),
      ...deriveTraceFields(toolCalls, closedSceneIds, assembled.campaignRules),
      finalNarration: narration,
      humanCorrections: [],
      createdAt: input.at,
    });

    db.exec(`RELEASE ${TURN_SAVEPOINT}`);
    recordTurnOutcome(
      deps.diagnostics,
      input,
      input.at,
      'accepted',
      dispositionAttempt,
      rounds,
      Date.now() - turnStartMs,
      null,
      {
        auditorCallCount,
        primaryDmCandidateCount: dispositionAttempt,
        retryCauses,
        toolsRerunDuringRetry,
      },
    );
    return {
      ok: true,
      turnId: input.turnId,
      narration,
      toolCalls,
      sceneId: activeScene.sceneId,
      modelRounds: rounds,
      error: undefined,
      isRateLimit: false,
    };
  } catch (e) {
    db.exec(`ROLLBACK TO ${TURN_SAVEPOINT}`);
    db.exec(`RELEASE ${TURN_SAVEPOINT}`);
    // Any thrown failure — model/provider error, exhausted rounds, audit-retry
    // exhaustion — rolls the whole turn back to its pre-turn state. Record a
    // turn-error disposition so the log shows the candidate's effects were
    // discarded (eshyra-dwkm). Per-candidate detail, when an audit rejected a
    // candidate before the throw, was already emitted above; this confirms the
    // turn-level rollback even when the failing attempt produced no candidate.
    recordDispositionDebug(
      deps.debug,
      {
        campaignId: input.campaignId,
        sessionId: input.sessionId,
        turnId: input.turnId,
        purpose: 'turn_candidate_disposition',
      },
      dispositionAttempt,
      'rolled_back',
      'turn_error',
      [],
    );
    const error = sanitizeDiagnosticMessage(
      e instanceof Error ? e.message : String(e),
    );
    const isRateLimit = e instanceof ModelRateLimitError;
    const retryAfterSeconds = isRateLimit
      ? (e as ModelRateLimitError).retryAfterSeconds
      : undefined;
    try {
      recordTurnFailureDiagnostic(db, {
        campaignId: input.campaignId,
        sessionId: input.sessionId,
        turnId: input.turnId,
        createdAt: input.at,
        phase,
        error: e,
        modelRounds: rounds,
      });
    } catch {
      // Keep the original failed-turn result contract even if diagnostics fail.
    }
    recordTurnOutcome(
      deps.diagnostics,
      input,
      input.at,
      classifyFailureOutcome(e, phase),
      dispositionAttempt,
      rounds,
      Date.now() - turnStartMs,
      error,
      {
        auditorCallCount,
        primaryDmCandidateCount: dispositionAttempt,
        retryCauses,
        toolsRerunDuringRetry,
      },
    );
    return {
      ok: false,
      turnId: input.turnId,
      narration: '',
      toolCalls: [],
      sceneId: undefined,
      modelRounds: rounds,
      error,
      isRateLimit,
      ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
    };
  }
}
