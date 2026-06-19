import type { MemoryDrilldownSelector } from '../memory/summary.js';
import { memoryDrilldown } from '../memory/summary.js';
import type { Tool } from './toolRegistry.js';
import { asRecord, err, ok } from './toolRegistry.js';

export const memoryDrilldownTool: Tool = {
  name: 'memory_drilldown',
  // Read-only retrieval into omitted memory windows; no canon write (eshyra-dwkm).
  mutates: false,
  description:
    'Drill into an omitted scene_log window or older scene/session/arc ' +
    'summary excluded from the bounded prompt. args: a MemoryDrilldownSelector.',
  inputSchema: {
    type: 'object',
    properties: {
      target: {
        type: 'string',
        enum: ['scene', 'scene_log', 'session', 'arc'],
        description: 'The memory tier to drill into.',
      },
      campaignId: { type: 'string', minLength: 1 },
      sessionId: {
        type: 'string',
        description:
          'Required for "scene", "scene_log", and "session" targets.',
        minLength: 1,
      },
      sceneId: {
        type: 'string',
        description: 'Required for "scene" and "scene_log" targets.',
        minLength: 1,
      },
      arcId: {
        type: 'string',
        description: 'Required for the "arc" target.',
        minLength: 1,
      },
      beforeSeq: {
        type: 'integer',
        description:
          'For "scene_log": fetch entries with seq < beforeSeq (paging cursor).',
        minimum: 1,
      },
      limit: {
        type: 'integer',
        description:
          'For "scene_log": maximum number of older log entries to return.',
        minimum: 1,
      },
    },
    required: ['target', 'campaignId'],
    additionalProperties: false,
  },
  run(args, ctx) {
    const a = asRecord(args);
    if (a === undefined || typeof a.target !== 'string') {
      return err('invalid_args', 'memory_drilldown requires a selector');
    }
    const result = memoryDrilldown(
      ctx.db,
      a as unknown as MemoryDrilldownSelector,
    );
    if (result === undefined) {
      return err('not_found', 'no memory record for that selector');
    }
    return ok(result);
  },
};
