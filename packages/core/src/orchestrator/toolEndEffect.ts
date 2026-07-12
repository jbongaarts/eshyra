import type { EndActiveEffectInput } from '../state/activeEffects.js';
import { endActiveEffect } from '../state/activeEffects.js';
import { effectToolError } from './toolEffectShared.js';
import type { Tool } from './toolRegistry.js';
import { asRecord, err, ok } from './toolRegistry.js';

export const endEffectTool: Tool = {
  name: 'end_effect',
  // Ends the durable effect and cleans up its owned projections (eshyra-dwkm).
  mutates: true,
  description:
    'End an active effect by its actual rule and clean up exactly the ' +
    'state it owns (its projected conditions and linked actors), in one ' +
    'transaction. Reasons: "expired" (natural duration end; an ' +
    'until-trigger effect needs its trigger named; a round timer still in ' +
    'combat cannot expire early), "dismissed" (requires a dismissible ' +
    'effect), "concentration-broken" with detail "voluntary" or "forced" ' +
    '(damage saves go through resolve_concentration instead; casting a new ' +
    'concentration spell replaces automatically via start_effect), ' +
    '"dispelled", "replaced", "source-removed", or "ruled" (requires a ' +
    'note). Re-delivering the same end is a harmless no-op.',
  inputSchema: {
    type: 'object',
    properties: {
      effectId: { type: 'string', minLength: 1 },
      reason: {
        type: 'string',
        enum: [
          'expired',
          'dismissed',
          'concentration-broken',
          'dispelled',
          'replaced',
          'source-removed',
          'ruled',
        ],
      },
      detail: {
        type: 'string',
        description:
          'Concentration break cause ("voluntary" or "forced"); required ' +
          'iff reason is "concentration-broken".',
        minLength: 1,
      },
      note: {
        type: 'string',
        description: 'Audit note; required for reason "ruled".',
        minLength: 1,
      },
      trigger: {
        type: 'string',
        description:
          'The semantic trigger that fired; required to expire an ' +
          'until-trigger effect and must match its declared trigger.',
        minLength: 1,
      },
    },
    required: ['effectId', 'reason'],
    additionalProperties: false,
  },
  run(args, ctx) {
    const a = asRecord(args);
    if (
      a === undefined ||
      typeof a.effectId !== 'string' ||
      typeof a.reason !== 'string'
    ) {
      return err('invalid_args', 'end_effect requires { effectId, reason }');
    }
    try {
      return ok(
        endActiveEffect(ctx.db, {
          campaignId: ctx.campaignId,
          effectId: a.effectId,
          reason: a.reason as EndActiveEffectInput['reason'],
          ...(typeof a.detail === 'string' ? { detail: a.detail } : {}),
          ...(typeof a.note === 'string' ? { note: a.note } : {}),
          ...(typeof a.trigger === 'string' ? { trigger: a.trigger } : {}),
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
