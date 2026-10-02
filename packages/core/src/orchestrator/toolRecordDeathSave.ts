import {
  EncounterCombatantError,
  resolveCombatantDeathSave,
} from '../state/encounterCombatants.js';
import { recordDeathSave } from '../state/hpLifecycle.js';
import { MutateStateError } from '../state/mutateState.js';
import type { Tool } from './toolRegistry.js';
import {
  asRecord,
  CHARACTER_TARGET_SCHEMA,
  err,
  ok,
  resolveTargetCharacterId,
} from './toolRegistry.js';

export const recordDeathSaveTool: Tool = {
  name: 'record_death_save',
  // Writes death-save counters and life state — a canon write (eshyra-dwkm).
  mutates: true,
  description:
    'Record a natural d20 death-save result for a dying character or opted-in player-character combatant. Obtain the natural result through `roll` and pass it here.',
  inputSchema: {
    type: 'object',
    properties: {
      roll: {
        type: 'integer',
        description: 'Natural d20 result (1-20), unmodified.',
        minimum: 1,
        maximum: 20,
      },
      character: CHARACTER_TARGET_SCHEMA,
      combatantId: { type: 'string', minLength: 1 },
    },
    required: ['roll'],
    additionalProperties: false,
  },
  run(args, ctx) {
    const a = asRecord(args);
    if (a === undefined || typeof a.roll !== 'number') {
      return err('invalid_args', 'record_death_save requires { roll: 1-20 }');
    }
    if (a.character !== undefined && a.combatantId !== undefined)
      return err('invalid_args', 'provide character or combatantId, not both');
    if (typeof a.combatantId === 'string') {
      try {
        return ok(
          resolveCombatantDeathSave(
            ctx.db,
            ctx.campaignId,
            a.combatantId,
            a.roll,
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
    const target = resolveTargetCharacterId(a.character, ctx);
    if ('ok' in target) {
      return target;
    }
    try {
      const result = recordDeathSave(
        ctx.db,
        a.roll,
        {
          provenance: `model:${ctx.turnId}`,
          sessionId: ctx.sessionId,
          at: ctx.at,
          characterId: target.id,
        },
        ctx.rng,
      );
      return ok(result);
    } catch (e) {
      if (e instanceof MutateStateError) {
        return err('mutate_error', e.message);
      }
      throw e;
    }
  },
};
