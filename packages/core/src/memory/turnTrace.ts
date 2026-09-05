import type { Db } from '../persistence/db.js';
import { withTransaction } from '../persistence/db.js';
import { jsonColumn } from '../persistence/jsonColumn.js';
import { requireNonEmpty } from '../validation.js';

export type TurnTraceConsentScope = 'private' | 'training_allowed';
export type TraceJsonValue =
  | string
  | number
  | boolean
  | null
  | TraceJsonValue[]
  | { [key: string]: TraceJsonValue };

export interface CampaignRulesEvidenceRule {
  ruleIdentity: string;
  ruleKind: string;
  status: string;
  provenance: string;
  effectivePosition: string;
  governingRecordKeys: string[];
}

export interface CampaignRulesEvidenceRuling {
  ruleIdentity: string;
  ambiguityId: string;
  selectedInterpretationId: string;
  effectivePosition: string;
}

export interface CampaignRulesEvidence {
  position: string;
  rules: CampaignRulesEvidenceRule[];
  rulings: CampaignRulesEvidenceRuling[];
  unresolvedAmbiguityIds: string[];
  conflictingAmbiguityIds: string[];
  ambiguitySourceUnavailable?: string;
}

export interface TurnTraceRecord {
  campaignId: string;
  sessionId: string;
  turnId: string;
  consentScope: TurnTraceConsentScope;
  playerInput: string;
  /** Concrete id of the PC acting on this turn (resolved at turn time). */
  actingCharacterId?: string;
  retrievedContext: TraceJsonValue[];
  promptProfile: string;
  modelOutput: string;
  toolCalls: TraceJsonValue[];
  rulesResolution: TraceJsonValue;
  /** Active campaign-rule identities supplied to both models for this turn. */
  campaignRulesEvidence?: CampaignRulesEvidence;
  acceptedStateDelta: TraceJsonValue[];
  rejectedCandidates: TraceJsonValue[];
  finalNarration: string;
  memoryUpdates: TraceJsonValue[];
  humanCorrections: string[];
  qualityFlags: string[];
  createdAt: string;
}

export interface TurnTraceKey {
  campaignId: string;
  sessionId: string;
  turnId: string;
}

export class TurnTraceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TurnTraceError';
  }
}

/** JSON codecs for the `turn_trace` table's JSON-backed columns. */
const traceColumns = {
  retrievedContext: jsonColumn<TraceJsonValue[]>(
    'turn_trace.retrieved_context',
  ),
  toolCalls: jsonColumn<TraceJsonValue[]>('turn_trace.tool_calls'),
  rulesResolution: jsonColumn<TraceJsonValue>('turn_trace.rules_resolution'),
  campaignRulesEvidence: jsonColumn<CampaignRulesEvidence>(
    'turn_trace.campaign_rules_evidence',
  ),
  acceptedStateDelta: jsonColumn<TraceJsonValue[]>(
    'turn_trace.accepted_state_delta',
  ),
  rejectedCandidates: jsonColumn<TraceJsonValue[]>(
    'turn_trace.rejected_candidates',
  ),
  memoryUpdates: jsonColumn<TraceJsonValue[]>('turn_trace.memory_updates'),
  humanCorrections: jsonColumn<string[]>('turn_trace.human_corrections'),
  qualityFlags: jsonColumn<string[]>('turn_trace.quality_flags'),
};

export function recordTurnTrace(db: Db, trace: TurnTraceRecord): void {
  validateTrace(trace);
  withTransaction(db, (txnDb) => {
    txnDb
      .prepare(
        `INSERT INTO turn_trace(
           campaign_id,
           session_id,
           turn_id,
           consent_scope,
           player_input,
           acting_character_id,
           retrieved_context_json,
           prompt_profile,
           model_output,
           tool_calls_json,
           rules_resolution_json,
           campaign_rules_evidence,
           accepted_state_delta_json,
           rejected_candidates_json,
           final_narration,
           memory_updates_json,
           human_corrections_json,
           quality_flags_json,
           created_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(campaign_id, session_id, turn_id) DO UPDATE SET
           consent_scope = excluded.consent_scope,
           player_input = excluded.player_input,
           acting_character_id = excluded.acting_character_id,
           retrieved_context_json = excluded.retrieved_context_json,
           prompt_profile = excluded.prompt_profile,
           model_output = excluded.model_output,
           tool_calls_json = excluded.tool_calls_json,
           rules_resolution_json = excluded.rules_resolution_json,
           campaign_rules_evidence = excluded.campaign_rules_evidence,
           accepted_state_delta_json = excluded.accepted_state_delta_json,
           rejected_candidates_json = excluded.rejected_candidates_json,
           final_narration = excluded.final_narration,
           memory_updates_json = excluded.memory_updates_json,
           human_corrections_json = excluded.human_corrections_json,
           quality_flags_json = excluded.quality_flags_json,
           created_at = excluded.created_at`,
      )
      .run(
        trace.campaignId,
        trace.sessionId,
        trace.turnId,
        trace.consentScope,
        trace.playerInput,
        trace.actingCharacterId ?? null,
        traceColumns.retrievedContext.encode(trace.retrievedContext),
        trace.promptProfile,
        trace.modelOutput,
        traceColumns.toolCalls.encode(trace.toolCalls),
        traceColumns.rulesResolution.encode(trace.rulesResolution),
        trace.campaignRulesEvidence === undefined
          ? null
          : traceColumns.campaignRulesEvidence.encode(
              trace.campaignRulesEvidence,
            ),
        traceColumns.acceptedStateDelta.encode(trace.acceptedStateDelta),
        traceColumns.rejectedCandidates.encode(trace.rejectedCandidates),
        trace.finalNarration,
        traceColumns.memoryUpdates.encode(trace.memoryUpdates),
        traceColumns.humanCorrections.encode(trace.humanCorrections),
        traceColumns.qualityFlags.encode(trace.qualityFlags),
        trace.createdAt,
      );
  });
}

export function getTurnTrace(
  db: Db,
  key: TurnTraceKey,
): TurnTraceRecord | undefined {
  const row = db
    .prepare(
      `SELECT
         campaign_id,
         session_id,
         turn_id,
         consent_scope,
         player_input,
         acting_character_id,
         retrieved_context_json,
         prompt_profile,
         model_output,
         tool_calls_json,
         rules_resolution_json,
         campaign_rules_evidence,
         accepted_state_delta_json,
         rejected_candidates_json,
         final_narration,
         memory_updates_json,
         human_corrections_json,
         quality_flags_json,
         created_at
       FROM turn_trace
       WHERE campaign_id = ? AND session_id = ? AND turn_id = ?`,
    )
    .get(key.campaignId, key.sessionId, key.turnId) as TurnTraceRow | undefined;

  if (row === undefined) {
    return undefined;
  }
  return turnTraceFromRow(row);
}

/**
 * All recorded turn traces for a session, ordered by `created_at` then
 * `turn_id`. Used by the session-recap composer to aggregate accepted state
 * deltas across the session.
 */
export function listTurnTraces(
  db: Db,
  selector: { campaignId: string; sessionId: string },
): TurnTraceRecord[] {
  const rows = db
    .prepare(
      `SELECT
         campaign_id,
         session_id,
         turn_id,
         consent_scope,
         player_input,
         acting_character_id,
         retrieved_context_json,
         prompt_profile,
         model_output,
         tool_calls_json,
         rules_resolution_json,
         campaign_rules_evidence,
         accepted_state_delta_json,
         rejected_candidates_json,
         final_narration,
         memory_updates_json,
         human_corrections_json,
         quality_flags_json,
         created_at
       FROM turn_trace
       WHERE campaign_id = ? AND session_id = ?
       ORDER BY created_at ASC, turn_id ASC`,
    )
    .all(selector.campaignId, selector.sessionId) as TurnTraceRow[];
  return rows.map(turnTraceFromRow);
}

function turnTraceFromRow(row: TurnTraceRow): TurnTraceRecord {
  return {
    campaignId: row.campaign_id,
    sessionId: row.session_id,
    turnId: row.turn_id,
    consentScope: row.consent_scope as TurnTraceConsentScope,
    playerInput: row.player_input,
    actingCharacterId: row.acting_character_id ?? undefined,
    retrievedContext: traceColumns.retrievedContext.decode(
      row.retrieved_context_json,
    ),
    promptProfile: row.prompt_profile,
    modelOutput: row.model_output,
    toolCalls: traceColumns.toolCalls.decode(row.tool_calls_json),
    rulesResolution: traceColumns.rulesResolution.decode(
      row.rules_resolution_json,
    ),
    ...(row.campaign_rules_evidence === null
      ? {}
      : {
          campaignRulesEvidence: traceColumns.campaignRulesEvidence.decode(
            row.campaign_rules_evidence,
          ),
        }),
    acceptedStateDelta: traceColumns.acceptedStateDelta.decode(
      row.accepted_state_delta_json,
    ),
    rejectedCandidates: traceColumns.rejectedCandidates.decode(
      row.rejected_candidates_json,
    ),
    finalNarration: row.final_narration,
    memoryUpdates: traceColumns.memoryUpdates.decode(row.memory_updates_json),
    humanCorrections: traceColumns.humanCorrections.decode(
      row.human_corrections_json,
    ),
    qualityFlags: traceColumns.qualityFlags.decode(row.quality_flags_json),
    createdAt: row.created_at,
  };
}

function validateTrace(trace: TurnTraceRecord): void {
  requireNonEmpty(
    TurnTraceError,
    [
      ['campaignId', trace.campaignId],
      ['sessionId', trace.sessionId],
      ['turnId', trace.turnId],
      ['playerInput', trace.playerInput],
      ['promptProfile', trace.promptProfile],
      ['modelOutput', trace.modelOutput],
      ['finalNarration', trace.finalNarration],
      ['createdAt', trace.createdAt],
    ],
    (field) => `turn trace ${field} is required`,
  );
}

interface TurnTraceRow {
  campaign_id: string;
  session_id: string;
  turn_id: string;
  consent_scope: string;
  player_input: string;
  acting_character_id: string | null;
  retrieved_context_json: string;
  prompt_profile: string;
  model_output: string;
  tool_calls_json: string;
  rules_resolution_json: string;
  campaign_rules_evidence: string | null;
  accepted_state_delta_json: string;
  rejected_candidates_json: string;
  final_narration: string;
  memory_updates_json: string;
  human_corrections_json: string;
  quality_flags_json: string;
  created_at: string;
}
