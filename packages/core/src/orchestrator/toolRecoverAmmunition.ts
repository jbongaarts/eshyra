import { resolveCharacterId } from '../state/activeCharacter.js';
import { AmmunitionError, recoverAmmunition } from '../state/ammunition.js';
import type { Tool } from './toolRegistry.js';
import {
  asRecord,
  CHARACTER_TARGET_SCHEMA,
  err,
  ok,
  resolveTargetCharacterId,
} from './toolRegistry.js';

export const recoverAmmunitionTool: Tool = {
  name: 'recover_ammunition',
  mutates: true,
  requiresExplicitAction: true,
  description:
    'After the battle’s combat instance is closed, recover half the expended ammunition, rounded down per ammunition identity, limited to what is still at the battlefield. The remaining present pieces are destroyed; pieces no longer present are reported as unavailable. The result reports entitlement, returned, destroyed, and unavailable counts. Call after the battle; the tool does not advance the clock.',
  inputSchema: {
    type: 'object',
    properties: {
      combatInstanceId: {
        type: 'string',
        minLength: 1,
        description: 'Combat instance whose battlefield is being searched.',
      },
      character: CHARACTER_TARGET_SCHEMA,
    },
    required: ['combatInstanceId'],
    additionalProperties: false,
  },
  run(args, ctx) {
    const input = asRecord(args);
    if (input === undefined || typeof input.combatInstanceId !== 'string')
      return err(
        'invalid_args',
        'recover_ammunition requires { combatInstanceId }',
      );
    const target = resolveTargetCharacterId(input.character, ctx);
    if ('ok' in target) return target;
    try {
      return ok(
        recoverAmmunition(ctx.db, input.combatInstanceId, {
          campaignId: ctx.campaignId,
          characterId: resolveCharacterId(ctx.db, target.id),
          provenance: `model:${ctx.turnId}`,
          sessionId: ctx.sessionId,
          at: ctx.at,
        }),
      );
    } catch (error) {
      if (error instanceof AmmunitionError)
        return err('mutate_error', error.message);
      throw error;
    }
  },
};
