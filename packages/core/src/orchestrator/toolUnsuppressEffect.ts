import { unsuppressEffect } from '../state/activeEffects.js';
import { effectToolError } from './toolEffectShared.js';
import type { Tool } from './toolRegistry.js';
import { asRecord, err, ok } from './toolRegistry.js';

export const unsuppressEffectTool: Tool = {
  name: 'unsuppress_effect',
  mutates: true,
  description:
    'Restore a suppressed effect to active status without creating a new ' +
    'effect or changing its targets, owned projections, concentration slot, ' +
    'timers, links, or durable identity. Suppression is temporary; use the ' +
    'existing terminal operations for ending, dispelling, dismissal, or ' +
    'concentration loss instead.',
  inputSchema: {
    type: 'object',
    properties: {
      effectId: { type: 'string', minLength: 1 },
      note: { type: 'string', description: 'Audit note.', minLength: 1 },
    },
    required: ['effectId'],
    additionalProperties: false,
  },
  run(args, ctx) {
    const a = asRecord(args);
    if (a === undefined || typeof a.effectId !== 'string') {
      return err('invalid_args', 'unsuppress_effect requires { effectId }');
    }
    try {
      return ok(
        unsuppressEffect(ctx.db, {
          campaignId: ctx.campaignId,
          effectId: a.effectId,
          ...(typeof a.note === 'string' ? { note: a.note } : {}),
          provenance: `model:${ctx.turnId}`,
          sessionId: ctx.sessionId,
          at: ctx.at,
        }),
      );
    } catch (e) {
      return effectToolError(e);
    }
  },
};
