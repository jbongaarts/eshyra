import { getCampaignRule } from '../campaign/campaignRuleStore.js';
import type { JsonSchema } from '../model/toolSchema.js';
import type { RollOverride } from '../state/rollEvidence.js';
import { ROLL_OVERRIDE_BASES } from '../state/rollEvidence.js';
import type { ToolContext, ToolResult } from './toolRegistry.js';
import { asRecord, err } from './toolRegistry.js';

/**
 * `rollOverride` — the recorded justification for a DM-supplied natural die
 * result on an engine-rolled tool (`record_death_save`, `restore_usage`
 * recharge). Mirrors start_effect's `durationOverride`: basis, a reason, and
 * an optional ruleId that must name an active house-rule campaign rule. The
 * override is recorded, not bound to a printed source.
 */
export const ROLL_OVERRIDE_SCHEMA: JsonSchema = {
  type: 'object',
  description:
    'Required whenever you supply the die result yourself instead of letting the engine roll it. basis is dm-adjudicated or house-rule; give a reason. ruleId, if supplied, must identify an active house-rule campaign rule. The override is recorded as unbound DM-supplied provenance.',
  properties: {
    basis: { type: 'string', enum: [...ROLL_OVERRIDE_BASES] },
    reason: { type: 'string', minLength: 1 },
    ruleId: { type: 'string', minLength: 1 },
  },
  required: ['basis', 'reason'],
  additionalProperties: false,
};

/** Validate `rollOverride`; the refusal message names `tool`. */
export function parseRollOverride(
  raw: unknown,
  ctx: ToolContext,
  tool: string,
): RollOverride | ToolResult {
  const o = asRecord(raw);
  if (
    o === undefined ||
    (o.basis !== 'dm-adjudicated' && o.basis !== 'house-rule') ||
    typeof o.reason !== 'string' ||
    o.reason.trim().length === 0 ||
    (o.ruleId !== undefined &&
      (typeof o.ruleId !== 'string' || o.ruleId.trim().length === 0))
  )
    return err(
      'invalid_args',
      `${tool}: rollOverride requires basis (dm-adjudicated or house-rule), a non-empty reason, and an optional non-empty ruleId`,
    );
  if (o.ruleId !== undefined) {
    const rule = getCampaignRule(ctx.db, {
      campaignId: ctx.campaignId,
      ruleIdentity: o.ruleId as string,
    });
    if (
      rule === undefined ||
      rule.status !== 'active' ||
      rule.ruleKind !== 'house-rule'
    )
      return err(
        'invalid_args',
        `${tool}: rollOverride.ruleId '${o.ruleId}' must resolve to an active house-rule campaign rule`,
      );
  }
  return {
    basis: o.basis,
    reason: o.reason.trim(),
    ...(typeof o.ruleId === 'string' ? { ruleId: o.ruleId } : {}),
  };
}

export function isToolResult(v: RollOverride | ToolResult): v is ToolResult {
  return 'ok' in v;
}
