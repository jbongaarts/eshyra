import type { SceneRecord } from './scene.js';
import { closeScene, getOpenScene, openScene, SceneError } from './scene.js';
import type { Tool } from './toolRegistry.js';
import { asRecord, err, ok } from './toolRegistry.js';

export interface MarkSceneToolData {
  boundary: 'open' | 'close';
  scene: SceneRecord;
}

export function isMarkSceneToolData(data: unknown): data is MarkSceneToolData {
  const record = asRecord(data);
  if (
    record === undefined ||
    (record.boundary !== 'open' && record.boundary !== 'close')
  ) {
    return false;
  }
  const scene = asRecord(record.scene);
  return typeof scene?.sceneId === 'string';
}

export const markSceneTool: Tool = {
  name: 'mark_scene',
  // Opens/closes scene rows — a canon write (eshyra-dwkm).
  mutates: true,
  description:
    'Open or close a scene. args: { boundary: "open" | "close", title?: string }.',
  inputSchema: {
    type: 'object',
    properties: {
      boundary: {
        type: 'string',
        enum: ['open', 'close'],
        description: 'Whether to open a new scene or close the current one.',
      },
      title: {
        type: 'string',
        description: 'Required when boundary is "open"; ignored when "close".',
        minLength: 1,
      },
    },
    required: ['boundary'],
    additionalProperties: false,
  },
  run(args, ctx) {
    const a = asRecord(args);
    if (a === undefined || (a.boundary !== 'open' && a.boundary !== 'close')) {
      return err(
        'invalid_args',
        'mark_scene requires { boundary: "open" | "close" }',
      );
    }
    try {
      if (a.boundary === 'open') {
        if (typeof a.title !== 'string' || a.title.length === 0) {
          return err('invalid_args', 'mark_scene open requires a title');
        }
        const scene = openScene(ctx.db, {
          campaignId: ctx.campaignId,
          sessionId: ctx.sessionId,
          sceneId: `scene-${ctx.turnId}`,
          title: a.title,
          at: ctx.at,
        });
        return ok({ boundary: 'open', scene } satisfies MarkSceneToolData);
      }
      const open = getOpenScene(ctx.db, ctx);
      if (open === undefined) {
        return err('no_open_scene', 'no open scene to close');
      }
      const scene = closeScene(ctx.db, {
        campaignId: ctx.campaignId,
        sessionId: ctx.sessionId,
        sceneId: open.sceneId,
        at: ctx.at,
      });
      return ok({ boundary: 'close', scene } satisfies MarkSceneToolData);
    } catch (e) {
      if (e instanceof SceneError) {
        return err('scene_error', e.message);
      }
      throw e;
    }
  },
};
