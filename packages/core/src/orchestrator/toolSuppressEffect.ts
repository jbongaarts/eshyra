import { suppressEffect } from '../state/activeEffects.js';
import { effectToolError } from './toolEffectShared.js';
import type { Tool } from './toolRegistry.js';
import { asRecord, err, ok } from './toolRegistry.js';

export const suppressEffectTool: Tool = {
  name: 'suppress_effect',
  mutates: true,
  description:
    'Temporarily suppress an active effect without ending it or cleaning up ' +
    'its targets and owned projections. Concentration ownership, timers, ' +
    'durable identity, and links remain intact; use unsuppress_effect to ' +
    'restore this same effect rather than creating a new one. Ending, ' +
    'dispelling, dismissal, or concentration loss use the existing terminal ' +
    'operations instead.',
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
      return err('invalid_args', 'suppress_effect requires { effectId }');
    }
    try {
      return ok(
        suppressEffect(ctx.db, {
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
