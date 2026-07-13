import {
  concentrationSaveDc,
  resolveConcentrationCheck,
} from '../state/activeEffects.js';
import { ResolutionError, resolveD20 } from './resolution.js';
import {
  EFFECT_PARTICIPANT_SCHEMA,
  effectToolError,
  resolveEffectParticipant,
} from './toolEffectShared.js';
import type { Tool } from './toolRegistry.js';
import { asRecord, err, ok } from './toolRegistry.js';
import {
  ADVANTAGE_SCHEMA,
  DISADVANTAGE_SCHEMA,
  MODIFIERS_SCHEMA,
  PROFICIENCY_SCHEMA,
  parseCheckSide,
} from './toolResolutionShared.js';

export const resolveConcentrationTool: Tool = {
  name: 'resolve_concentration',
  // Rolls the save from the seeded RNG, records the outcome, and may end the
  // effect (eshyra-dwkm).
  mutates: true,
  description:
    'Roll AND resolve the Constitution saving throw a concentrating ' +
    'creature owes after taking damage, in one atomic step. The engine ' +
    'computes the DC as max(10, floor(damage/2)) — per damage event, from ' +
    'the damage dealt even when temporary HP absorbed it (adjust_hp / ' +
    'update_combatant report when this call is owed) — rolls the d20 from ' +
    'the seeded RNG (2d20kh1/kl1 under advantage/disadvantage), applies ' +
    'your declared Constitution-save modifiers and proficiency, derives ' +
    'the outcome, and on failure ends the effect and cleans up its owned ' +
    'projections (break-policy aware) in the same transaction. Never roll ' +
    'the save separately or report an outcome yourself. Incapacitation and ' +
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
      advantage: ADVANTAGE_SCHEMA,
      disadvantage: DISADVANTAGE_SCHEMA,
      modifiers: MODIFIERS_SCHEMA,
      proficiency: PROFICIENCY_SCHEMA,
    },
    required: ['owner', 'damage'],
    additionalProperties: false,
  },
  run(args, ctx) {
    const a = asRecord(args);
    if (a === undefined || typeof a.damage !== 'number') {
      return err(
        'invalid_args',
        'resolve_concentration requires { owner, damage }',
      );
    }
    const owner = resolveEffectParticipant(a.owner, ctx, 'owner');
    if ('ok' in owner) {
      return owner;
    }
    try {
      const side = parseCheckSide(a, 'resolve_concentration');
      const dc = concentrationSaveDc(a.damage);
      // The save is engine-rolled through the F9 primitive; the model only
      // declares WHICH modifiers apply (its ruling), never the outcome.
      const resolution = resolveD20(
        {
          kind: 'saving_throw',
          advantage: side.advantage,
          disadvantage: side.disadvantage,
          modifiers: side.modifiers,
          ...(side.proficiency === undefined
            ? {}
            : { proficiency: side.proficiency }),
          vs: dc,
        },
        ctx.rng,
      );
      const result = resolveConcentrationCheck(ctx.db, {
        campaignId: ctx.campaignId,
        owner,
        damage: a.damage,
        save: {
          vs: dc,
          dice: resolution.dice,
          rolls: resolution.rolls,
          natural: resolution.natural,
          modifierTotal: resolution.modifierTotal,
          total: resolution.total,
        },
        provenance: `model:${ctx.turnId}`,
        sessionId: ctx.sessionId,
        at: ctx.at,
      });
      // `category` + the full resolution ride the tool result so the roll
      // ledger and turn trace capture the save like any resolve_check.
      return ok({ category: 'saving_throw', resolution, ...result });
    } catch (e) {
      if (e instanceof ResolutionError) {
        return err('invalid_resolution', e.message);
      }
      return effectToolError(e);
    }
  },
};
