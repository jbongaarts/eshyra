import {
  EncounterCombatantError,
  stabilizeCombatant,
} from '../state/encounterCombatants.js';
import { stabilizeCharacter } from '../state/hpLifecycle.js';
import { MutateStateError } from '../state/mutateState.js';
import type { Tool } from './toolRegistry.js';
import {
  asRecord,
  CHARACTER_TARGET_SCHEMA,
  err,
  ok,
  resolveTargetCharacterId,
} from './toolRegistry.js';

export const stabilizeCharacterTool: Tool = {
  name: 'stabilize_character',
  // Writes character life state — a canon write (eshyra-dwkm).
  mutates: true,
  description:
    'Record stabilization for a dying character or opted-in player-character combatant after a successful check or stabilizing effect.',
  inputSchema: {
    type: 'object',
    properties: {
      character: CHARACTER_TARGET_SCHEMA,
      combatantId: { type: 'string', minLength: 1 },
    },
    additionalProperties: false,
  },
  run(args, ctx) {
    const a = asRecord(args) ?? {};
    if (a.character !== undefined && a.combatantId !== undefined)
      return err('invalid_args', 'provide character or combatantId, not both');
    if (typeof a.combatantId === 'string') {
      try {
        return ok(
          stabilizeCombatant(
            ctx.db,
            ctx.campaignId,
            a.combatantId,
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
      const result = stabilizeCharacter(
        ctx.db,
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
