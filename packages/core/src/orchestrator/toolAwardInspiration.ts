import { awardInspiration, InspirationError } from '../state/inspiration.js';
import type { Tool } from './toolRegistry.js';
import {
  asRecord,
  CHARACTER_TARGET_SCHEMA,
  err,
  ok,
  resolveTargetCharacterId,
} from './toolRegistry.js';

export const awardInspirationTool: Tool = {
  name: 'award_inspiration',
  // Writes the character's durable inspiration boolean (eshyra-dwkm).
  mutates: true,
  description:
    'Award inspiration to a character for playing out their personality ' +
    'traits, ideal, bond, or flaw in a compelling way (a DM judgment ' +
    'call). Inspiration is binary and cannot be stockpiled: awarding it ' +
    'to a character who already has it is refused. args: { character?: ' +
    'string }.',
  inputSchema: {
    type: 'object',
    properties: {
      character: CHARACTER_TARGET_SCHEMA,
    },
    additionalProperties: false,
  },
  run(args, ctx) {
    const a = asRecord(args) ?? {};
    const target = resolveTargetCharacterId(a.character, ctx);
    if ('ok' in target) {
      return target;
    }
    try {
      return ok(
        awardInspiration(ctx.db, {
          ...(target.id === undefined ? {} : { characterRef: target.id }),
          provenance: `model:${ctx.turnId}`,
          sessionId: ctx.sessionId,
          at: ctx.at,
        }),
      );
    } catch (e) {
      if (e instanceof InspirationError) {
        return err('inspiration_error', e.message);
      }
      throw e;
    }
  },
};
