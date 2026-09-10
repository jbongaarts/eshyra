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
    'The engine validates the operation and all economy/effect references, refuses insufficient resources, ' +
    'and applies deterministic costs. Use the instance id shown in inventory context, not the pack ref.',
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
