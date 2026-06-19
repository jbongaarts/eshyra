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
import type { Db } from '../persistence/db.js';
import { resolveActingCharacterId } from '../state/activeCharacter.js';
import { assembleContext, renderContextMessage } from './contextAssembler.js';
import { buildSystemPrompt, type ToolProtocol } from './protocol.js';
import { createSeededRng } from './rng.js';
import type { ToolContext, ToolRegistry } from './tools.js';
import type { AuditVerdict, TurnAuditor } from './turnAuditor.js';
import {
  type ExecutedToolCall,
  OrchestratorError,
  runModelLoop,
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

export interface RunTurnDeps {
  db: Db;
  model: ModelClient;
  registry: ToolRegistry;
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
}

/** Developer-facing message for a turn that failed the mechanics audit twice. */
function formatAuditFailure(verdict: AuditVerdict): string {
  const tools =
    verdict.missingRequiredTools.length > 0
      ? verdict.missingRequiredTools.join(', ')
      : '(unspecified)';
  return `turn rejected by mechanics audit after retry: missing required tool(s) [${tools}] — ${verdict.reason || 'no reason given'}`;
}

/** Corrective note appended to the context for a single audited retry. */
function formatCorrectiveNote(
  verdict: AuditVerdict,
  toolNames: readonly string[],
): string {
  const tools =
    verdict.missingRequiredTools.length > 0
      ? verdict.missingRequiredTools.join(', ')
      : toolNames.join(', ');
  return [
    '## Correction Required',
    'Your previous response asserted a mechanical outcome without calling the',
    'tool that owns it, so it was rejected and NOT shown to the player.',
    verdict.repairInstruction ||
      `Call the required tool(s) before narrating: ${tools}.`,
    `Use your native tool interface to call: ${tools}. Do not state any dice`,
    'result, state change, or rules fact unless a tool produced it this turn.',
  ].join('\n');
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
  };

  // Tracked here (not inside runModelLoop) so the failure path can still
  // report the round count the turn reached before it threw.
  let rounds = 0;
  let phase = 'resolve_acting_character';
  // Last candidate attempt reached, so the catch path can label the turn-error
  // rollback disposition with the attempt it aborted on (eshyra-dwkm).
  let dispositionAttempt = 0;

  db.exec(`SAVEPOINT ${TURN_SAVEPOINT}`);
  try {
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
    // accepted unconditionally (the legacy/test path).
    const maxAttempts = deps.auditor ? 2 : 1;
    let narration = '';
    let toolCalls: ExecutedToolCall[] = [];
    let correctiveNote: string | undefined;
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
        },
      });

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
        narration = candidate.narration;
        toolCalls = candidate.toolCalls;
        break;
      }

      phase = 'mechanics_audit';
      const verdict = await deps.auditor.audit({
        playerInput: input.playerInput,
        candidateResponse: candidate.narration,
        providedToolNames: registry.list(),
        executedToolCalls: candidate.toolCalls,
        trace: { ...auditTrace, extra: { purpose: 'turn_audit' } },
      });
      const accepted = verdict.verdict === 'accept';
      const action: 'accept' | 'retry' | 'fail' = accepted
        ? 'accept'
        : attempt < maxAttempts
          ? 'retry'
          : 'fail';
      recordAuditDebug(deps.debug, {
        kind: 'turn_audit',
        trace: { ...auditTrace, purpose: 'turn_audit' },
        attempt,
        verdict: verdict.verdict,
        missingRequiredTools: verdict.missingRequiredTools,
        executedToolNames: candidate.toolCalls.map((c) => c.tool),
        action,
        auditorModel: deps.auditor.modelId ?? 'unknown',
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
        narration = candidate.narration;
        toolCalls = candidate.toolCalls;
        break;
      }

      // Rejected: discard this candidate's tool mutations so nothing it wrote can
      // survive, then either retry with a corrective note or fail the turn.
      db.exec(`ROLLBACK TO ${ATTEMPT_SAVEPOINT}`);
      db.exec(`RELEASE ${ATTEMPT_SAVEPOINT}`);
      recordDispositionDebug(
        deps.debug,
        dispositionTrace,
        attempt,
        'rolled_back',
        'audit_rejected',
        candidate.toolCalls,
      );
      if (action === 'fail') {
        throw new OrchestratorError(formatAuditFailure(verdict));
      }
      phase = 'model_loop';
      correctiveNote = formatCorrectiveNote(verdict, registry.list());
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
      ...deriveTraceFields(toolCalls, closedSceneIds),
      finalNarration: narration,
      humanCorrections: [],
      createdAt: input.at,
    });

    db.exec(`RELEASE ${TURN_SAVEPOINT}`);
    return {
      ok: true,
      turnId: input.turnId,
      narration,
      toolCalls,
      sceneId: activeScene.sceneId,
      modelRounds: rounds,
      error: undefined,
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
    return {
      ok: false,
      turnId: input.turnId,
      narration: '',
      toolCalls: [],
      sceneId: undefined,
      modelRounds: rounds,
      error,
    };
  }
}
