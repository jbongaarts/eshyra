import type { AuditRetryCause } from '../model/usage.js';
import type { AuditVerdict } from './turnAuditor.js';
import type { ExecutedToolCall } from './turnLoop.js';

const STATE_TOOLS = new Set([
  'adjust_hp',
  'add_condition',
  'remove_condition',
  'update_combatant',
  'start_encounter',
  'close_combat',
  'give_item',
  'remove_item',
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
