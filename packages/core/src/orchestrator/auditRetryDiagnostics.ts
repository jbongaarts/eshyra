import type { AuditRetryCause } from '../model/usage.js';
import {
  ROLL_CATEGORIES,
  ROLL_VISIBILITIES,
  type RollCategory,
  type RollVisibility,
} from './toolRoll.js';
import type { AuditVerdict } from './turnAuditor.js';
import type { ExecutedToolCall } from './turnLoop.js';

const STATE_TOOLS = new Set([
  'adjust_hp',
  'record_death_save',
  'stabilize_character',
  'grant_temporary_hp',
  'add_condition',
  'remove_condition',
  'update_combatant',
  'start_encounter',
  'close_combat',
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
  'give_item',
  'transfer_item',
  'remove_item',
  'gain_currency',
  'spend_currency',
  'convert_currency',
  'update_clock',
  'set_plot_flag',
  'record_world_fact',
]);

const WORLD_EVIDENCE_TOOLS = new Set([
  'world_query',
  'lookup_rules',
  'memory_drilldown',
]);

function missingTools(verdict: AuditVerdict): Set<string> {
  return new Set([
    ...verdict.missingRequiredTools,
    ...verdict.missingRequiredCalls.map((call) => call.tool),
  ]);
}

function readField(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

function hasExplicitRollPresentationMetadata(call: ExecutedToolCall): boolean {
  if (call.tool !== 'roll' || !call.result.ok) {
    return false;
  }
  const visibility = readField(call.result.data, 'visibility');
  const category = readField(call.result.data, 'category');
  return (
    typeof visibility === 'string' &&
    ROLL_VISIBILITIES.includes(visibility as RollVisibility) &&
    typeof category === 'string' &&
    ROLL_CATEGORIES.includes(category as RollCategory)
  );
}

function isPlayerVisibleRoll(call: ExecutedToolCall): boolean {
  return (
    call.tool === 'roll' &&
    call.result.ok &&
    readField(call.result.data, 'visibility') === 'player_visible'
  );
}

/**
 * Classify a rejected audit verdict that can be handled without regenerating
 * the primary-DM candidate. The verdict must opt into the repair explicitly and
 * the deterministic evidence must be strong enough to render the code-owned
 * player-visible roll ledger. Any failed tool, non-roll missing requirement, or
 * absent roll visibility/category metadata fails closed into the normal retry
 * path.
 */
export function classifyAuditPresentationRepair(
  verdict: AuditVerdict,
  toolCalls: readonly ExecutedToolCall[],
): AuditRetryCause | null {
  if (
    verdict.verdict !== 'reject' ||
    verdict.presentationOnlyRepair?.kind !== 'roll_ledger' ||
    verdict.disallowedToolCalls.length > 0
  ) {
    return null;
  }
  const missing = missingTools(verdict);
  if ([...missing].some((tool) => tool !== 'roll')) {
    return null;
  }
  if (toolCalls.some((call) => !call.result.ok)) {
    return null;
  }
  const rollCalls = toolCalls.filter((call) => call.tool === 'roll');
  if (
    rollCalls.length === 0 ||
    !rollCalls.every(hasExplicitRollPresentationMetadata) ||
    !rollCalls.some(isPlayerVisibleRoll)
  ) {
    return null;
  }
  return 'presentation_only_roll_ledger';
}

/**
 * Classify why a rejected audit verdict would cause a primary-DM retry.
 *
 * The auditor still owns the reasoning decision; this helper only projects the
 * structured verdict and deterministic failed-tool evidence into stable metrics
 * for cost/retry analysis.
 */
export function classifyAuditRetryCause(
  verdict: AuditVerdict,
  toolCalls: readonly ExecutedToolCall[],
): AuditRetryCause | null {
  if (verdict.verdict === 'accept') {
    return null;
  }
  if (
    toolCalls.some(
      (call) =>
        !call.result.ok &&
        (call.result.code === 'invalid_target' ||
          call.result.code === 'not_found' ||
          call.result.code === 'ambiguous_target'),
    )
  ) {
    return 'invalid_target';
  }

  const missing = missingTools(verdict);
  if (missing.has('roll')) {
    return 'missing_roll_visibility';
  }
  if ([...missing].some((tool) => STATE_TOOLS.has(tool))) {
    return 'missing_state';
  }
  if ([...missing].some((tool) => WORLD_EVIDENCE_TOOLS.has(tool))) {
    return 'missing_world_evidence';
  }
  if (verdict.disallowedToolCalls.length > 0) {
    return 'disallowed_tool';
  }
  if (missing.size === 0) {
    return 'auditor_over_rejection';
  }
  return 'unknown';
}
