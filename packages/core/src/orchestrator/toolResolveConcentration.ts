import { resolveConcentrationCheck } from '../state/activeEffects.js';
import {
  EFFECT_PARTICIPANT_SCHEMA,
  effectToolError,
  resolveEffectParticipant,
} from './toolEffectShared.js';
import type { Tool } from './toolRegistry.js';
import { asRecord, err, ok } from './toolRegistry.js';

export const resolveConcentrationTool: Tool = {
  name: 'resolve_concentration',
  // Records the check outcome and may end the effect (eshyra-dwkm).
  mutates: true,
  description:
    'Record the outcome of a concentration saving throw after damage. ' +
    'Whenever a concentrating creature takes damage it must make a ' +
    'Constitution save at DC max(10, floor(damage/2)) — per damage event, ' +
    'computed from the damage dealt even when temporary HP absorbed it ' +
    '(adjust_hp reports the DC for characters). Roll the save first with ' +
    'resolve_check (kind saving_throw, vs = that DC), then call this with ' +
    'the same damage/vs and the outcome. The engine re-derives the DC and ' +
    'refuses mismatched evidence. On failure the effect ends and its owned ' +
    'projections are cleaned up (break-policy aware). Incapacitation and ' +
    'death break concentration automatically — no save, no call needed.',
  inputSchema: {
    type: 'object',
    properties: {
      owner: {
        ...EFFECT_PARTICIPANT_SCHEMA,
        description: 'The concentrating creature.',
      },
      damage: {
        type: 'integer',
        minimum: 1,
        description: 'Full damage of the triggering event.',
      },
      vs: {
        type: 'integer',
        minimum: 1,
        description:
          'DC the save was rolled against; must equal max(10, floor(damage/2)).',
      },
      outcome: { type: 'string', enum: ['success', 'failure'] },
      rollRef: {
        type: 'string',
        description:
          'Pointer to the seeded roll (e.g. the resolve_check activity), ' +
          'for the audit ledger.',
        minLength: 1,
      },
    },
    required: ['owner', 'damage', 'vs', 'outcome'],
    additionalProperties: false,
  },
  run(args, ctx) {
    const a = asRecord(args);
    if (
      a === undefined ||
      typeof a.damage !== 'number' ||
      typeof a.vs !== 'number' ||
      (a.outcome !== 'success' && a.outcome !== 'failure')
    ) {
      return err(
        'invalid_args',
        'resolve_concentration requires { owner, damage, vs, outcome }',
      );
    }
    const owner = resolveEffectParticipant(a.owner, ctx, 'owner');
    if ('ok' in owner) {
      return owner;
    }
    try {
      return ok(
        resolveConcentrationCheck(ctx.db, {
          campaignId: ctx.campaignId,
          owner,
          damage: a.damage,
          vs: a.vs,
          outcome: a.outcome,
          ...(typeof a.rollRef === 'string' ? { rollRef: a.rollRef } : {}),
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
