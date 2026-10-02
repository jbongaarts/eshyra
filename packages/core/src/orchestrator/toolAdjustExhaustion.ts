import { EncounterCombatantError } from '../state/encounterCombatants.js';
import { adjustExhaustion } from '../state/exhaustionMutation.js';
import { MutateStateError } from '../state/mutateState.js';
import type { Tool } from './toolRegistry.js';
import {
  asRecord,
  CHARACTER_TARGET_SCHEMA,
  err,
  ok,
  resolveTargetCharacterId,
} from './toolRegistry.js';

export const adjustExhaustionTool: Tool = {
  name: 'adjust_exhaustion',
  mutates: true,
  description:
    "Change exhaustion by a source-declared number of levels for a character or active encounter combatant. Levels clamp at 6; level 6 is death; at level 4 or higher the engine halves the hit point maximum; level below 1 removes exhaustion. The engine applies the level 4 and level 6 effects; the other levels' effects are declared on the relevant rolls.",
  inputSchema: {
    type: 'object',
    properties: {
      delta: {
        type: 'integer',
        minimum: -6,
        maximum: 6,
        description:
          'Non-zero signed number of levels imposed or removed by the source effect.',
      },
      character: CHARACTER_TARGET_SCHEMA,
      combatantId: {
        type: 'string',
        minLength: 1,
        description: 'Exact active encounter combatant id.',
      },
    },
    required: ['delta'],
    additionalProperties: false,
  },
  run(args, ctx) {
    const a = asRecord(args);
    if (
      !a ||
      typeof a.delta !== 'number' ||
      !Number.isInteger(a.delta) ||
      a.delta === 0 ||
      a.delta < -6 ||
      a.delta > 6
    )
      return err(
        'invalid_args',
        'adjust_exhaustion requires a non-zero integer delta from -6 to 6',
      );
    if (
      a.combatantId !== undefined &&
      (typeof a.combatantId !== 'string' || a.combatantId.length === 0)
    )
      return err('invalid_args', 'combatantId must be a non-empty string');
    if (a.combatantId !== undefined && a.character !== undefined)
      return err(
        'invalid_args',
        'provide either character or combatantId, not both',
      );
    const character =
      a.combatantId === undefined
        ? resolveTargetCharacterId(a.character, ctx)
        : undefined;
    if (character && 'ok' in character) return character;
    try {
      return ok(
        adjustExhaustion(ctx.db, {
          delta: a.delta,
          ...(typeof a.combatantId === 'string'
            ? {
                combatantId: a.combatantId,
                campaignId: ctx.campaignId,
                resolveRulesPack: ctx.resolveRulesPack,
              }
            : { characterId: character?.id }),
          provenance: `model:${ctx.turnId}`,
          sessionId: ctx.sessionId,
          at: ctx.at,
        }),
      );
    } catch (e) {
      if (e instanceof MutateStateError || e instanceof EncounterCombatantError)
        return err('mutate_error', e.message);
      throw e;
    }
  },
};
