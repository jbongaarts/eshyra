import { removeEffectTarget } from '../state/activeEffects.js';
import {
  effectToolError,
  resolveEffectParticipant,
} from './toolEffectShared.js';
import type { Tool } from './toolRegistry.js';
import { asRecord, err, ok } from './toolRegistry.js';

export const removeEffectTargetTool: Tool = {
  name: 'remove_effect_target',
  // Removes one target and exactly its owned projections (eshyra-dwkm).
  mutates: true,
  description:
    'Remove one target from a multi-target active effect — e.g. a Hold ' +
    'Person target that made its save — cleaning up exactly that ' +
    'target’s projected conditions while the effect (and every other ' +
    'target) continues. This never ends the effect itself: when the rule ' +
    'ends the whole effect, use end_effect. Repeating the same removal is ' +
    'a harmless no-op.',
  inputSchema: {
    type: 'object',
    properties: {
      effectId: { type: 'string', minLength: 1 },
      target: {
        type: 'object',
        properties: {
          kind: {
            type: 'string',
            enum: ['character', 'combatant', 'campaign_actor', 'scope'],
          },
          ref: { type: 'string', minLength: 1 },
        },
        required: ['kind', 'ref'],
        additionalProperties: false,
      },
      reason: {
        type: 'string',
        description: 'Why the target left (e.g. "saved", "ruled").',
        minLength: 1,
      },
    },
    required: ['effectId', 'target', 'reason'],
    additionalProperties: false,
  },
  run(args, ctx) {
    const a = asRecord(args);
    const rawTarget = asRecord(a?.target);
    if (
      a === undefined ||
      rawTarget === undefined ||
      typeof a.effectId !== 'string' ||
      typeof a.reason !== 'string'
    ) {
      return err(
        'invalid_args',
        'remove_effect_target requires { effectId, target, reason }',
      );
    }
    let target: {
      kind: 'character' | 'combatant' | 'campaign_actor' | 'scope';
      ref: string;
    };
    if (rawTarget.kind === 'scope') {
      if (typeof rawTarget.ref !== 'string' || rawTarget.ref.length === 0) {
        return err('invalid_args', 'target.ref must be a non-empty string');
      }
      target = { kind: 'scope', ref: rawTarget.ref };
    } else {
      const resolved = resolveEffectParticipant(rawTarget, ctx, 'target');
      if ('ok' in resolved) {
        return resolved;
      }
      target = resolved;
    }
    try {
      return ok(
        removeEffectTarget(ctx.db, {
          campaignId: ctx.campaignId,
          effectId: a.effectId,
          target,
          reason: a.reason,
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
