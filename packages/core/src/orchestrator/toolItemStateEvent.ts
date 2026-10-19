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
    'the item’s current state. This records no action, turn resource, or owner ' +
    'cost. Undeclared, ambiguous, and non-executable conditions are refused with ' +
    'no change. A condition whose printed effect deducts charges from the item’s ' +
    'own economy (for example, a Cube of Force face losing charges when a listed ' +
    'spell or effect contacts its barrier) also requires tableRow: the DM decides ' +
    'that the barrier was targeted or contacted and which listed spell or item ' +
    'did it. Send only rows the source table lists; unlisted spells or effects ' +
    'cause no charge loss and must not be sent. The result reports the rolled ' +
    'amount, the amount deducted, and the remaining charges; exhausted is true ' +
    'when none remain. When exhausted, the DM then sends the printed condition ' +
    '“the cube runs out of charges” as its own item_state_event. A condition ' +
    'whose printed effect is that the item becomes nonmagical (the Ring of ' +
    'Djinni Summoning: “the djinni dies”) makes the instance durably ' +
    'nonmagical and ends every live grant bound to it in the same transaction, ' +
    'with no cooldown. Send it only when the creature actually died, not when ' +
    'it dropped to 0 hit points and returned home.',
  inputSchema: {
    type: 'object',
    properties: {
      instanceId: { type: 'string', minLength: 1 },
      condition: {
        type: 'string',
        minLength: 1,
        description: 'Exact condition text from a declared state transition.',
      },
      tableRow: {
        type: 'string',
        minLength: 1,
        description:
          'Exact row key from the printed economy-deduction table (for example, a listed spell or item name). Required only for conditions that deduct charges; refused for all others.',
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
      typeof a.condition !== 'string' ||
      (a.tableRow !== undefined && typeof a.tableRow !== 'string')
    )
      return err(
        'invalid_args',
        'item_state_event requires { instanceId, condition } and an optional string tableRow',
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
          ...(a.tableRow === undefined ? {} : { tableRow: a.tableRow }),
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
