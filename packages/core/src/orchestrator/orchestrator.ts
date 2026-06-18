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
const DEFAULT_MAX_TOOL_ROUNDS = 8;

export interface RunTurnDeps {
  db: Db;
  model: ModelClient;
  registry: ToolRegistry;
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
    const { narration, toolCalls } = await runModelLoop({
      model,
      registry,
      toolCtx,
      system: buildSystemPrompt(registry, {
        toolProtocol: input.toolProtocol ?? 'native',
      }),
      initialUserMessage: renderContextMessage(assembled),
      maxToolRounds,
      onRoundStart: () => {
        rounds += 1;
      },
      trace: {
        campaignId: input.campaignId,
        sessionId: input.sessionId,
        turnId: input.turnId,
        purpose: 'turn_model_loop',
      },
    });

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
