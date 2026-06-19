import type { WorldQueryTarget } from '../world/types.js';
import { worldQuery } from '../world/worldQuery.js';
import type { Tool } from './toolRegistry.js';
import { asRecord, err, ok } from './toolRegistry.js';

export const worldQueryTool: Tool = {
  name: 'world_query',
  // Read-only world resolution (template + overlay); no canon write (eshyra-dwkm).
  mutates: false,
  description:
    'Resolve a world target (template + live overlay). ' +
    'The result includes visibility annotations: fields marked DM-only ' +
    '(e.g. an NPC\'s "secret") must not be narrated to the player verbatim. ' +
    'args: { type: "location"|"encounter"|"npc"|"lore"|"meta", id?: string }.',
  inputSchema: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['location', 'encounter', 'npc', 'lore', 'meta'],
        description: 'The world target kind to resolve.',
      },
      id: {
        type: 'string',
        description:
          'Target id. Required for every type except "meta" (the singleton ' +
          'pack metadata).',
      },
    },
    required: ['type'],
    additionalProperties: false,
  },
  run(args, ctx) {
    const a = asRecord(args);
    if (a === undefined || typeof a.type !== 'string') {
      return err('invalid_args', 'world_query requires { type, id? }');
    }
    const result = worldQuery(ctx.db, a as unknown as WorldQueryTarget);
    if (result.ok) {
      return ok(result);
    }
    return err(result.code, result.message);
  },
};
