import type { CampaignRulesContext } from '../campaign/campaignContext.js';
import type { CampaignRulingProjection } from '../campaign/campaignRules.js';
import type {
  CampaignRulesEvidence,
  TraceJsonValue,
} from '../memory/turnTrace.js';
import { isMarkSceneToolData } from './tools.js';
import type { ExecutedToolCall } from './turnLoop.js';

/**
 * Project a turn's executed tool calls into the structured turn-trace fields
 * (E5). The trace recorder takes opaque JSON shapes; this module is the
 * orchestrator-specific lens that interprets the tool stream and produces:
 * - `acceptedStateDelta` — canon mutations the tool layer applied.
 * - `rejectedCandidates` — mutations / tool calls the model proposed that a
 *   tool refused (invalid args, unknown tool, malformed tool call).
 * - `rulesResolution` — deterministic-layer outcomes (dice, SRD lookups).
 * - `campaignRulesEvidence` — A3 identities supplied to both models.
 * - `memoryUpdates` — scene summaries the turn rolled up.
 * - `qualityFlags` — signals worth surfacing for later review.
 *
 * `extractClosedSceneIds` is the matching projection for the scene-summary
 * hook: it pulls the unique sceneIds that the `mark_scene` tool just closed
 * out of the executed tool stream.
 *
 * `humanCorrections` has no source in an unattended turn and stays empty.
 */

export interface DerivedTraceFields {
  rulesResolution: TraceJsonValue;
  campaignRulesEvidence: CampaignRulesEvidence | undefined;
  acceptedStateDelta: TraceJsonValue[];
  rejectedCandidates: TraceJsonValue[];
  memoryUpdates: TraceJsonValue[];
  qualityFlags: string[];
}

/** Project the exact assembled campaign-rule context into durable A3 evidence. */
export function campaignRulesEvidenceFrom(
  ctx: CampaignRulesContext,
): CampaignRulesEvidence {
  const rulings = new Map<string, CampaignRulingProjection>();
  for (const ruling of ctx.unboundRulings)
    rulings.set(ruling.ruleIdentity, ruling);
  for (const { ruling, conflictingRulings } of ctx.ambiguities) {
    if (ruling !== undefined) rulings.set(ruling.ruleIdentity, ruling);
    for (const conflicting of conflictingRulings)
      rulings.set(conflicting.ruleIdentity, conflicting);
  }
  return {
    position: ctx.position,
    rules: [...ctx.rules, ...ctx.unrepresentableRules].map((rule) => ({
      ruleIdentity: rule.ruleIdentity,
      ruleKind: rule.ruleKind,
      status: rule.status,
      provenance: rule.provenance,
      effectivePosition: rule.effectivePosition,
      governingRecordKeys: [...rule.governingRecordKeys],
    })),
    rulings: [...rulings.values()].map((ruling) => ({
      ruleIdentity: ruling.ruleIdentity,
      ambiguityId: ruling.ambiguityId,
      selectedInterpretationId: ruling.selectedInterpretationId,
      effectivePosition: ruling.effectivePosition,
    })),
    unresolvedAmbiguityIds: ctx.ambiguities
      .filter(
        ({ ruling, conflictingRulings }) =>
          ruling === undefined && conflictingRulings.length <= 1,
      )
      .map(({ ambiguity }) => ambiguity.id),
    conflictingAmbiguityIds: ctx.ambiguities
      .filter(({ conflictingRulings }) => conflictingRulings.length > 1)
      .map(({ ambiguity }) => ambiguity.id),
    ...(ctx.ambiguitySourceUnavailable === undefined
      ? {}
      : { ambiguitySourceUnavailable: ctx.ambiguitySourceUnavailable }),
  };
}

function closedSceneIdOf(call: ExecutedToolCall): string | undefined {
  if (call.tool !== 'mark_scene' || !call.result.ok) {
    return undefined;
  }
  if (!isMarkSceneToolData(call.result.data)) {
    return undefined;
  }
  return call.result.data.boundary === 'close'
    ? call.result.data.scene.sceneId
    : undefined;
}

export function extractClosedSceneIds(
  toolCalls: readonly ExecutedToolCall[],
): string[] {
  return [
    ...new Set(
      toolCalls
        .map(closedSceneIdOf)
        .filter((id): id is string => id !== undefined),
    ),
  ];
}

export function deriveTraceFields(
  toolCalls: readonly ExecutedToolCall[],
  summarizedSceneIds: readonly string[],
  campaignRules?: CampaignRulesContext,
): DerivedTraceFields {
  const argsOf = (call: ExecutedToolCall): TraceJsonValue =>
    (call.args ?? null) as TraceJsonValue;
  const okData = (tool: string): TraceJsonValue[] =>
    toolCalls
      .filter((call) => call.tool === tool && call.result.ok)
      .map((call) =>
        call.result.ok ? (call.result.data as TraceJsonValue) : null,
      );

  const acceptedStateDelta = toolCalls
    .filter((call) => {
      if (!call.mutates || !call.result.ok) return false;
      if (call.tool !== 'spend_spell_slot') return true;
      const data = call.result.data as Record<string, unknown>;
      return data.spent === true;
    })
    .map((call): TraceJsonValue => {
      if (call.tool !== 'spend_spell_slot' || !call.result.ok) {
        return argsOf(call);
      }
      return {
        tool: call.tool,
        args: argsOf(call),
        result: call.result.data as TraceJsonValue,
      };
    });

  const rejectedCandidates = toolCalls
    .filter((call) => !call.result.ok)
    .map(
      (call): TraceJsonValue => ({
        tool: call.tool,
        args: argsOf(call),
        code: call.result.ok ? null : call.result.code,
        message: call.result.ok ? null : call.result.message,
      }),
    );

  const qualityFlags: string[] = [];
  if (toolCalls.some((call) => call.tool === 'unknown')) {
    qualityFlags.push('tool_parse_error');
  }
  if (toolCalls.some((call) => call.tool !== 'unknown' && !call.result.ok)) {
    qualityFlags.push('tool_error');
  }

  return {
    campaignRulesEvidence:
      campaignRules === undefined
        ? undefined
        : campaignRulesEvidenceFrom(campaignRules),
    rulesResolution: {
      rolls: okData('roll'),
      // F1/F9 deterministic resolutions (eshyra-2n1t.3 / eshyra-2n1t.11):
      // each entry carries the original dice, kept/dropped selection,
      // natural result, declared modifiers, and outcome, so a trace replay
      // never needs to reconstruct math from narration.
      checks: okData('resolve_check'),
      contests: okData('resolve_contest'),
      damage: okData('resolve_damage'),
      calcs: okData('calc'),
      rulesLookups: okData('lookup_rules'),
      spellScaling: okData('resolve_spell_upcast').concat(
        okData('spend_spell_slot')
          .map((entry) => (entry as Record<string, unknown>).upcast)
          .filter(
            (upcast): upcast is TraceJsonValue =>
              upcast !== null && upcast !== undefined,
          ),
      ),
    },
    acceptedStateDelta,
    rejectedCandidates,
    memoryUpdates: summarizedSceneIds.map(
      (sceneId): TraceJsonValue => ({ kind: 'scene_summary', sceneId }),
    ),
    qualityFlags,
  };
}
