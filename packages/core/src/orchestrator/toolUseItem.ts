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
    "An item that casts or summons 'as if you had cast' a spell uses the item's printed activation (for example, the Elemental Gem's action), not the spell's casting time. " +
    'Before use, call don_item, hold_item, or attune_item as needed. A refusal names the unmet equipment alternatives and leaves the turn budget and item state unchanged. ' +
    'TURN RESOURCE: when the operation prints an action, bonus-action or reaction activation, and the acting character is in the active combat, ' +
    'use_item spends that resource itself (for a spell the operation casts it passes the spell, so the bonus-action-spell rule applies; ' +
    "with no printed cost the spell's own casting time of 1 action / bonus action / reaction is spent). " +
    'Do NOT also call spend_turn_resource for the same activation: that double-spends. If the resource is unavailable ' +
    '(already used, not their turn for an action or bonus action, surprised) use_item refuses and changes nothing. ' +
    "A spend that starts a typed entity grant's cooldown returns hint.bindGrant, the grant this spend can pay for. Bind it with start_effect (source.grantRef = hint.bindGrant, source.itemInstanceId = this instance) only when the outcome you adjudicate actually produces that creature; its cooldown starts only when that bound effect ends. " +
    "Some activations roll for their outcome first, and a different outcome is not that grant: on an Efreeti Bottle's first opening the efreeti may attack you (01-10) or cast wish three times for you (91-00) instead of serving, and on a fourth opening it escapes, so do not bind serving-efreeti for those (run an attacking efreeti as a ruling-sourced summoning). An unbound spend stays recoverable until such a summon is bound. " +
    'A spend of a non-anchored cooldown economy (per-day uses, charges, single-use units) that a typed grant names returns hint.bindCredits [{creditId, economyId, grantIds}]: each credit pays for exactly one start_effect bind of one listed grant on this instance, and start_effect refuses such a bind without an unredeemed credit. ' +
    "A listed grant whose count is rolled (the Horn of Valhalla's berserkers) carries the engine's own roll in that credit's rolledCounts [{grantId, notation, rolls, total}]: bind exactly total linked actors and pass that creditId as start_effect source.bindCreditId, since start_effect refuses any other count or credit and never accepts a count or roll from you. " +
    "A listed grant whose creature is rolled (the Bag of Tricks' d8 on its color's table) carries the engine's d8 in that credit's rolledCreatures [{grantId, notation, roll, creatureRef}]: bind exactly that creature and pass that creditId as start_effect source.bindCreditId, since start_effect refuses any other creature or credit and never accepts a creature or roll from you. " +
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
          'Operation-specific validated inputs. Only the names the operation reads are accepted; any other name is refused and the error lists the accepted ones. Variable costs use { costs: { <economyId>: <positive integer> } }. Ambiguous state transitions require transitionTo; declared failure paths use transitionOutcome: "failure".',
        properties: {
          transitionTo: {
            type: 'string',
            minLength: 1,
            description:
              'Declared destination state id; required only when the operation has several candidate transitions.',
          },
          transitionOutcome: {
            type: 'string',
            enum: ['success', 'failure'],
            description:
              'Declared failure path; omitted means success. Only for an operation that is the via of a state transition.',
          },
          costs: {
            type: 'object',
            description:
              'Positive integer amount for each variable-cost economy of the operation, keyed by economy id. Only for an operation with a variable cost.',
            additionalProperties: { type: 'integer', minimum: 1 },
          },
        },
        // Deliberately open: the accepted names depend on the selected
        // operation, so the item-layer validator refuses any other name and
        // lists that operation's accepted ones (eshyra-o9bd.16.10.3 S1).
      },
      levers: {
        type: 'array',
        minItems: 1,
        maxItems: 2,
        description:
          "Only for an operation that moves rows of a printed table in one use (the Apparatus of the Crab's move-levers: as many as two levers up or down for one action): [{ lever: <row number>, direction: 'up' | 'down' }] with DISTINCT lever numbers. Required for that operation and refused for any other. A third lever is another use_item call and another action. The result returns each selected lever's printed cell; the resulting state is yours to adjudicate (every lever returns to neutral after each use).",
        items: {
          type: 'object',
          properties: {
            lever: { type: 'integer' },
            direction: { type: 'string', enum: ['up', 'down'] },
          },
          required: ['lever', 'direction'],
          additionalProperties: false,
        },
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
    if (
      a.args !== undefined &&
      (typeof a.args !== 'object' || a.args === null || Array.isArray(a.args))
    )
      return err(
        'invalid_args',
        'use_item args must be an object of operation-specific inputs',
      );
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
          levers: a.levers,
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
