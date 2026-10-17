import type {
  EffectDurationInput,
  ItemDurationProvenance,
} from '../state/activeEffects.js';
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
    'start_effect. When the effect comes from a spell whose record has a ' +
    'timed duration, a supplied duration must equal it; other effects ' +
    'accept the supplied duration unchecked. Omit duration to re-anchor ' +
    'the existing one from now. An item-power effect keeps its printed typed duration: a different duration needs durationOverride (basis and reason), which records it as a DM override. An effect bound to an item grant (a granted creature) never has its lifetime rewritten by refresh, with or without durationOverride: to change or cut it short, call end_effect for the whole grant with a ruling.',
  inputSchema: {
    type: 'object',
    properties: {
      effectId: { type: 'string', minLength: 1 },
      duration: EFFECT_DURATION_SCHEMA,
      durationOverride: {
        type: 'object',
        description:
          'Required to change a printed item-power duration: { basis: dm-adjudicated | house-rule, reason }. Never accepted for an item-grant effect (use end_effect).',
        properties: {
          basis: { enum: ['dm-adjudicated', 'house-rule'] },
          reason: { type: 'string', minLength: 1 },
        },
        required: ['basis', 'reason'],
        additionalProperties: false,
      },
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
    let durationProvenance: ItemDurationProvenance | undefined;
    if (a.durationOverride !== undefined) {
      const override = asRecord(a.durationOverride);
      if (
        override === undefined ||
        (override.basis !== 'dm-adjudicated' &&
          override.basis !== 'house-rule') ||
        typeof override.reason !== 'string' ||
        override.reason.trim().length === 0
      )
        return err(
          'invalid_args',
          'durationOverride requires basis (dm-adjudicated or house-rule) and a non-empty reason',
        );
      durationProvenance = {
        kind: 'dm-override',
        basis: override.basis,
        reason: override.reason.trim(),
      };
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
          ...(durationProvenance === undefined ? {} : { durationProvenance }),
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
