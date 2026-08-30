import type { EffectDurationInput } from '../state/activeEffects.js';
import { refreshEffect } from '../state/activeEffects.js';
import {
  EFFECT_DURATION_SCHEMA,
  effectToolError,
  parseEffectDuration,
} from './toolEffectShared.js';
import type { Tool } from './toolRegistry.js';
import { asRecord, err, ok } from './toolRegistry.js';

export const refreshEffectTool: Tool = {
  name: 'refresh_effect',
  // Re-anchors the durable timer (eshyra-dwkm).
  mutates: true,
  description:
    'Re-anchor an active effect’s timer when its rule renews it — e.g. ' +
    'Animate Dead reasserted before the 24-hour control window lapses. ' +
    'Only an active (not suppressed, never ended) effect can refresh; a ' +
    'rule that re-establishes an ended effect creates a NEW effect via ' +
    'start_effect. A spell-grounded effect keeps its record duration; ' +
    'omit duration to re-anchor the existing one from now.',
  inputSchema: {
    type: 'object',
    properties: {
      effectId: { type: 'string', minLength: 1 },
      duration: EFFECT_DURATION_SCHEMA,
      note: {
        type: 'string',
        description: 'Audit note (what renewed it).',
        minLength: 1,
      },
    },
    required: ['effectId'],
    additionalProperties: false,
  },
  run(args, ctx) {
    const a = asRecord(args);
    if (a === undefined || typeof a.effectId !== 'string') {
      return err('invalid_args', 'refresh_effect requires { effectId }');
    }
    let duration: EffectDurationInput | undefined;
    if (a.duration !== undefined) {
      const parsed = parseEffectDuration(a.duration);
      if ('ok' in parsed) {
        return parsed;
      }
      duration = parsed;
    }
    try {
      return ok(
        refreshEffect(ctx.db, {
          campaignId: ctx.campaignId,
          effectId: a.effectId,
          ...(duration === undefined ? {} : { duration }),
          ...(typeof a.note === 'string' ? { note: a.note } : {}),
          resolveRulesPack: ctx.resolveRulesPack,
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
