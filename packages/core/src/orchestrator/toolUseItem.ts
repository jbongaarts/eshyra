import type { CampaignCapabilityInvocationEvent } from '../campaign/capabilityPreflight.js';
import { resolveCharacterId } from '../state/activeCharacter.js';
import { ItemStateError, useItem } from '../state/itemState.js';
import type { Tool } from './toolRegistry.js';
import {
  asRecord,
  CHARACTER_TARGET_SCHEMA,
  err,
  ok,
  resolveTargetCharacterId,
} from './toolRegistry.js';

const TOOL_NAME = 'use_item';

export const useItemTool: Tool = {
  name: TOOL_NAME,
  mutates: true,
  requiresExplicitAction: true,
  description:
    'Use one rules-pack-bound inventory instance through an operation declared by its magic-item record. ' +
    'The engine validates the operation and all economy/effect references, enforces its printed worn/held/attuned/on-person prerequisites, refuses insufficient resources, ' +
    'and applies deterministic costs. Use the instance id shown in inventory context, not the pack ref. ' +
    'Before use, call don_item, hold_item, or attune_item as needed. A refusal names the unmet equipment alternatives and leaves the turn budget and item state unchanged. ' +
    'TURN RESOURCE: when the operation prints an action, bonus-action or reaction activation, and the acting character is in the active combat, ' +
    'use_item spends that resource itself (for a spell the operation casts it passes the spell, so the bonus-action-spell rule applies; ' +
    "with no printed cost the spell's own casting time of 1 action / bonus action / reaction is spent). " +
    'Do NOT also call spend_turn_resource for the same activation: that double-spends. If the resource is unavailable ' +
    '(already used, not their turn for an action or bonus action, surprised) use_item refuses and changes nothing. ' +
    "The result's turnResource says what was spent or why nothing was (outside combat, free or consumed activation, a casting time " +
    'longer than a reaction that you adjudicate). A creature other than the acting character (a combatant, e.g. someone else ' +
    "releasing an Immovable Rod or smashing a Dust of Dryness pellet) is not charged by use_item; record that creature's " +
    'activation yourself with spend_turn_resource on its combatant.',
  inputSchema: {
    type: 'object',
    properties: {
      instanceId: {
        type: 'string',
        minLength: 1,
        description:
          'Inventory row id identifying this particular item instance.',
      },
      operationId: {
        type: 'string',
        minLength: 1,
        description: 'Stable operation id declared by the item rules record.',
      },
      args: {
        type: 'object',
        description:
          'Operation-specific validated inputs. Variable costs use { costs: { <economyId>: <positive integer> } }. Ambiguous state transitions require transitionTo; declared failure paths use transitionOutcome: "failure".',
      },
      character: CHARACTER_TARGET_SCHEMA,
    },
    required: ['instanceId', 'operationId'],
    additionalProperties: false,
  },
  run(args, ctx) {
    const a = asRecord(args);
    if (
      a === undefined ||
      typeof a.instanceId !== 'string' ||
      typeof a.operationId !== 'string'
    ) {
      return err(
        'invalid_args',
        'use_item requires { instanceId, operationId }',
      );
    }
    const instanceId = a.instanceId;
    const target = resolveTargetCharacterId(a.character, ctx);
    if ('ok' in target) return target;
    try {
      return ok(
        useItem(ctx.db, {
          campaignId: ctx.campaignId,
          instanceId: a.instanceId,
          operationId: a.operationId,
          args:
            typeof a.args === 'object' &&
            a.args !== null &&
            !Array.isArray(a.args)
              ? (a.args as Record<string, unknown>)
              : undefined,
          characterId: resolveCharacterId(ctx.db, target.id),
          // Bridges the item-domain capability event to the turn's observer,
          // adding only what the tool layer knows. The item domain neither
          // imports nor knows about discovery; the result below is untouched.
          ...(ctx.observeCapabilityInvocation === undefined
            ? {}
            : {
                onCapabilityInvocation: (
                  event: CampaignCapabilityInvocationEvent,
                ) => {
                  try {
                    ctx.observeCapabilityInvocation?.({
                      ...event,
                      tool: TOOL_NAME,
                      instanceId,
                    });
                  } catch {
                    // An observer must not be able to change what the tool
                    // returns, or observing would itself be intervention: this
                    // runs inside `useItem`, so a throw would abort the
                    // operation and surface as `item_error` to the DM and the
                    // mechanics auditor. Unreachable by contract — the only
                    // installed observer appends to a turn-owned array — and
                    // guarded regardless.
                  }
                },
              }),
          resolveRulesPack: ctx.resolveRulesPack,
          provenance: `model:${ctx.turnId}`,
          sessionId: ctx.sessionId,
          at: ctx.at,
          rng: ctx.rng,
        }),
      );
    } catch (error) {
      if (error instanceof ItemStateError)
        return err('item_error', error.message, error.capabilityPreflight);
      throw error;
    }
  },
};
