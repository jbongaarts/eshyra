import {
  EncounterCombatantError,
  setCombatantSuffocation,
} from '../state/encounterCombatants.js';
import { beginSuffocation, endSuffocation } from '../state/hpLifecycle.js';
import { MutateStateError } from '../state/mutateState.js';
import type { Tool } from './toolRegistry.js';
import {
  asRecord,
  CHARACTER_TARGET_SCHEMA,
  err,
  ok,
  resolveTargetCharacterId,
} from './toolRegistry.js';

export const setSuffocationTool: Tool = {
  name: 'set_suffocation',
  mutates: true,
  description:
    'Record suffocation for a character or combatant (combatantId). When breath runs out, the creature survives the interval from calc suffocation_survival_rounds; at the start of its next turn after that interval, event drop sets it to 0 hit points and blocks healing and stabilization until event breathe records that it can breathe again. A character or a player-character-rules combatant becomes dying; a monster-rules combatant dies. Never apply the drop as damage with adjust_hp or update_combatant.',
  inputSchema: {
    type: 'object',
    properties: {
      event: { type: 'string', enum: ['drop', 'breathe'] },
      character: CHARACTER_TARGET_SCHEMA,
      combatantId: { type: 'string', minLength: 1 },
    },
    required: ['event'],
    additionalProperties: false,
  },
  run(args, ctx) {
    const a = asRecord(args);
    if (a === undefined || (a.event !== 'drop' && a.event !== 'breathe'))
      return err(
        'invalid_args',
        "set_suffocation requires { event: 'drop' | 'breathe' }",
      );
    const target = resolveTargetCharacterId(a.character, ctx);
    if (a.character !== undefined && a.combatantId !== undefined)
      return err('invalid_args', 'provide character or combatantId, not both');
    if (typeof a.combatantId === 'string') {
      try {
        return ok(
          setCombatantSuffocation(
            ctx.db,
            ctx.campaignId,
            a.combatantId,
            a.event,
            {
              provenance: `model:${ctx.turnId}`,
              sessionId: ctx.sessionId,
              at: ctx.at,
            },
            ctx.rng,
          ),
        );
      } catch (e) {
        if (e instanceof EncounterCombatantError)
          return err('mutate_error', e.message);
        throw e;
      }
    }
    if ('ok' in target) return target;
    const mutationContext = {
      provenance: `model:${ctx.turnId}`,
      sessionId: ctx.sessionId,
      at: ctx.at,
      characterId: target.id,
    };
    try {
      return ok(
        a.event === 'drop'
          ? beginSuffocation(ctx.db, mutationContext)
          : endSuffocation(ctx.db, mutationContext, ctx.rng),
      );
    } catch (e) {
      if (e instanceof MutateStateError) return err('mutate_error', e.message);
      throw e;
    }
  },
};
