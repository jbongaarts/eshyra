import type { TraceJsonValue } from '../memory/turnTrace.js';
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
  acceptedStateDelta: TraceJsonValue[];
  rejectedCandidates: TraceJsonValue[];
  memoryUpdates: TraceJsonValue[];
  qualityFlags: string[];
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
): DerivedTraceFields {
  const argsOf = (call: ExecutedToolCall): TraceJsonValue =>
    (call.args ?? null) as TraceJsonValue;
  const okData = (tool: string): TraceJsonValue[] =>
    toolCalls
      .filter((call) => call.tool === tool && call.result.ok)
      .map((call) =>
        call.result.ok ? (call.result.data as TraceJsonValue) : null,
      );

  const STATE_TOOLS = new Set([
    'adjust_hp',
    'record_death_save',
    'stabilize_character',
    'grant_temporary_hp',
    'start_encounter',
    'update_combatant',
    'close_combat_instance',
    'begin_turn',
    'spend_turn_resource',
    'set_surprised',
    'spend_usage',
    'restore_usage',
    'reset_usage',
    'attune_item',
    'end_attunement',
    'award_inspiration',
    'use_inspiration',
    'add_condition',
    'remove_condition',
    'give_item',
    'remove_item',
    'gain_currency',
    'spend_currency',
    'convert_currency',
    'update_clock',
    'advance_time',
    'complete_short_rest',
    'complete_long_rest',
    'spend_rest_hit_die',
    'finish_short_rest_recovery',
    'set_plot_flag',
    'set_world_fact',
  ]);
  const acceptedStateDelta = toolCalls
    .filter((call) => STATE_TOOLS.has(call.tool) && call.result.ok)
    .map(argsOf);

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
    },
    acceptedStateDelta,
    rejectedCandidates,
    memoryUpdates: summarizedSceneIds.map(
      (sceneId): TraceJsonValue => ({ kind: 'scene_summary', sceneId }),
    ),
    qualityFlags,
  };
}
