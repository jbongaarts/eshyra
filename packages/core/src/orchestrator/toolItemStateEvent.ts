import { resolveCharacterId } from '../state/activeCharacter.js';
import {
  applyItemStateConditionEvent,
  ItemResetExecutorError,
} from '../state/itemResetExecutor.js';
import type { Tool } from './toolRegistry.js';
import {
  asRecord,
  CHARACTER_TARGET_SCHEMA,
  err,
  ok,
  resolveTargetCharacterId,
} from './toolRegistry.js';

export const itemStateEventTool: Tool = {
  name: 'item_state_event',
  mutates: true,
  requiresExplicitAction: false,
  description:
    'Apply a printed external event to a rules-pack-bound item state machine. ' +
    'Use this when the named condition has occurred; the DM determines whether ' +
    'it occurred. The condition must exactly match one transition declared from ' +
    'the item’s current state. This records no action, turn resource, or item ' +
    'economy cost. Undeclared and ambiguous conditions are refused.',
  inputSchema: {
    type: 'object',
    properties: {
      instanceId: { type: 'string', minLength: 1 },
      condition: {
        type: 'string',
        minLength: 1,
        description: 'Exact condition text from a declared state transition.',
      },
      character: CHARACTER_TARGET_SCHEMA,
    },
    required: ['instanceId', 'condition'],
    additionalProperties: false,
  },
  run(args, ctx) {
    const a = asRecord(args);
    if (
      a === undefined ||
      typeof a.instanceId !== 'string' ||
      typeof a.condition !== 'string'
    )
      return err(
        'invalid_args',
        'item_state_event requires { instanceId, condition }',
      );
    const target = resolveTargetCharacterId(a.character, ctx);
    if ('ok' in target) return target;
    try {
      const characterId = resolveCharacterId(ctx.db, target.id);
      const owned = ctx.db
        .prepare('SELECT 1 FROM inventory WHERE id = ? AND character_id = ?')
        .get(a.instanceId, characterId);
      if (owned === undefined)
        return err(
          'invalid_target',
          `character does not own inventory instance '${a.instanceId}'`,
        );
      return ok(
        applyItemStateConditionEvent(ctx.db, {
          instanceId: a.instanceId,
          condition: a.condition,
          provenance: `model:${ctx.turnId}`,
          sessionId: ctx.sessionId,
          at: ctx.at,
          rng: ctx.rng,
          resolveRulesPack: ctx.resolveRulesPack,
        }),
      );
    } catch (error) {
      if (error instanceof ItemResetExecutorError)
        return err('item_error', error.message);
      throw error;
    }
  },
};
