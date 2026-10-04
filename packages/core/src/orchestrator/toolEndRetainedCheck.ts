import { withTransaction } from '../persistence/db.js';
import type { Tool } from './toolRegistry.js';
import { asRecord, err, ok } from './toolRegistry.js';

export const endRetainedCheckTool: Tool = {
  name: 'end_retained_check',
  mutates: true,
  description:
    'End an active retained check when the creature is discovered or stops hiding. Whether either event occurred is your interpretation; the engine never ends a retained check automatically. args: { retainedCheckId, reason: "discovered" | "stopped" }.',
  inputSchema: {
    type: 'object',
    properties: {
      retainedCheckId: { type: 'string', minLength: 1 },
      reason: { type: 'string', enum: ['discovered', 'stopped'] },
    },
    required: ['retainedCheckId', 'reason'],
    additionalProperties: false,
  },
  run(args, ctx) {
    const a = asRecord(args);
    if (
      a === undefined ||
      typeof a.retainedCheckId !== 'string' ||
      !a.retainedCheckId ||
      (a.reason !== 'discovered' && a.reason !== 'stopped')
    )
      return err(
        'invalid_args',
        'end_retained_check requires retainedCheckId and reason discovered|stopped',
      );
    const changed = withTransaction(
      ctx.db,
      (db) =>
        db
          .prepare(
            `UPDATE retained_check SET status = 'ended', end_reason = ?, ended_at = ?, provenance = ?, session_id = ? WHERE campaign_id = ? AND retained_check_id = ? AND status = 'active'`,
          )
          .run(
            a.reason,
            ctx.at,
            `model:${ctx.turnId}`,
            ctx.sessionId,
            ctx.campaignId,
            a.retainedCheckId,
          ).changes,
    );
    if (changed === 0)
      return err('not_found_or_ended', 'active retained check was not found');
    return ok({
      retainedCheckId: a.retainedCheckId,
      status: 'ended',
      reason: a.reason,
    });
  },
};
