import type { WorldQueryTarget } from '../world/types.js';
import { worldQuery } from '../world/worldQuery.js';
import type { Tool } from './toolRegistry.js';
import { asRecord, err, ok } from './toolRegistry.js';

export const worldQueryTool: Tool = {
  name: 'world_query',
  // Read-only world resolution (template + overlay); no canon write (eshyra-dwkm).
  mutates: false,
  description:
    'Resolve or search a world target (module canon + campaign overlay lore). ' +
    'The result includes visibility annotations: fields marked DM-only ' +
    '(e.g. an NPC\'s "secret") must not be narrated to the player verbatim. ' +
    'args: { type: "location"|"encounter"|"npc"|"lore"|"meta"|"overlay_lore"|"search", id?, query?, locationId?, npcId?, subject?, kind?, tags? }.',
  inputSchema: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: [
          'location',
          'encounter',
          'npc',
          'lore',
          'meta',
          'overlay_lore',
          'search',
        ],
        description: 'The world target kind to resolve.',
      },
      id: {
        type: 'string',
        description:
          'Target id. Required for every type except "meta" (the singleton ' +
          'pack metadata).',
      },
      query: {
        type: 'string',
        description:
          'Search/discovery terms for type "search" or overlay lore filtering.',
      },
      locationId: {
        type: 'string',
        description: 'Filter overlay lore by location id.',
      },
      npcId: {
        type: 'string',
        description: 'Filter overlay lore by NPC id.',
      },
      subject: {
        type: 'string',
        description: 'Filter overlay lore by natural subject text.',
      },
      kind: {
        type: 'string',
        enum: [
          'rumor',
          'clue',
          'npc_detail',
          'location_detail',
          'quest_hook',
          'threat_report',
          'scene_consequence',
          'player_created_detail',
          'other',
        ],
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Overlay lore tags to require.',
      },
      includeInvalidated: {
        type: 'boolean',
        description: 'Include lore records that invalidate earlier records.',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 50,
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
