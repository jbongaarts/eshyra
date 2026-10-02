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
    'For a character or combatant: breathing again clears suffocation. When breath runs out, calculate the survival interval with calc_suffocation_survival_rounds; at the start of the creature’s next turn after that interval, record event drop here. The drop applies damage through adjust_hp or update_combatant: at 0 HP it does not block healing or stabilization and a player-character-rules combatant starts ordinary dying; a monster-rules combatant dies. Use this tool to record the suffocation state, not to apply the HP loss.',
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
