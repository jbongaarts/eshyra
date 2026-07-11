import {
  ActionEconomyError,
  type SetReactionAllowanceResult,
  setReactionAllowance,
} from '../state/actionEconomy.js';
import {
  type CombatantStatus,
  EncounterCombatantError,
  updateCombatant,
} from '../state/encounterCombatants.js';
import type { CharacterConditionEntry } from '../state/liveStateSchema.js';
import type { Tool } from './toolRegistry.js';
import { asRecord, err, ok } from './toolRegistry.js';

const COMBATANT_STATUSES: readonly CombatantStatus[] = [
  'alive',
  'dead',
  'unconscious',
  'escaped',
  'inactive',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const updateCombatantTool: Tool = {
  name: 'update_combatant',
  mutates: true,
  description:
    'Update a live encounter combatant by exact combatant id. args: { combatantId: string, hpDelta?: integer, addCondition?: {id:string,...}, removeCondition?: string, status?: "alive"|"dead"|"unconscious"|"escaped"|"inactive", locationId?: string, placement?: string, reactionAllowance?: integer }. reactionAllowance records the current total reactions per round for a creature whose rules record carries a state-dependent extraReactions mechanic (e.g. hydra Reactive Heads: 1 + heads beyond one); it is refused for other creatures.',
  inputSchema: {
    type: 'object',
    properties: {
      combatantId: {
        type: 'string',
        description:
          'Exact combatant id from the active combatants context, e.g. ci-watchtower-ambush-1-goblin-1.',
        minLength: 1,
      },
      hpDelta: {
        type: 'integer',
        description:
          'Signed HP delta. Negative damages, positive heals; clamped to [0, hpMax].',
      },
      addCondition: {
        type: 'object',
        description:
          'Condition object to add. Must include a non-empty id; extra JSON fields are preserved.',
        properties: {
          id: { type: 'string', minLength: 1 },
        },
        required: ['id'],
        additionalProperties: true,
      },
      removeCondition: {
        type: 'string',
        description: 'Condition id to remove from the combatant.',
        minLength: 1,
      },
      status: {
        type: 'string',
        enum: COMBATANT_STATUSES,
        description: 'Explicit combatant status override.',
      },
      locationId: {
        type: 'string',
        description: 'Optional updated current location id.',
        minLength: 1,
      },
      placement: {
        type: 'string',
        description: 'Optional updated tactical placement or zone.',
        minLength: 1,
      },
      reactionAllowance: {
        type: 'integer',
        description:
          'Current total reactions per round, for creatures whose rules ' +
          'record grants state-dependent extra reactions (validated against ' +
          'the record).',
        minimum: 1,
      },
    },
    required: ['combatantId'],
    additionalProperties: false,
  },
  run(args, ctx) {
    const a = asRecord(args);
    if (a === undefined || typeof a.combatantId !== 'string') {
      return err(
        'invalid_args',
        'update_combatant requires { combatantId: string }',
      );
    }
    if (a.hpDelta !== undefined && typeof a.hpDelta !== 'number') {
      return err('invalid_args', 'update_combatant hpDelta must be an integer');
    }
    if (a.addCondition !== undefined && !isRecord(a.addCondition)) {
      return err(
        'invalid_args',
        'update_combatant addCondition must be an object',
      );
    }
    if (
      a.removeCondition !== undefined &&
      typeof a.removeCondition !== 'string'
    ) {
      return err(
        'invalid_args',
        'update_combatant removeCondition must be a string',
      );
    }
    if (
      a.status !== undefined &&
      !COMBATANT_STATUSES.includes(a.status as CombatantStatus)
    ) {
      return err('invalid_args', 'update_combatant status is invalid');
    }
    if (a.locationId !== undefined && typeof a.locationId !== 'string') {
      return err(
        'invalid_args',
        'update_combatant locationId must be a string',
      );
    }
    if (a.placement !== undefined && typeof a.placement !== 'string') {
      return err('invalid_args', 'update_combatant placement must be a string');
    }
    if (
      a.reactionAllowance !== undefined &&
      typeof a.reactionAllowance !== 'number'
    ) {
      return err(
        'invalid_args',
        'update_combatant reactionAllowance must be an integer',
      );
    }
    const hasCombatantUpdate =
      a.hpDelta !== undefined ||
      a.addCondition !== undefined ||
      a.removeCondition !== undefined ||
      a.status !== undefined ||
      a.locationId !== undefined ||
      a.placement !== undefined;
    try {
      let reactionAllowance: SetReactionAllowanceResult | undefined;
      if (typeof a.reactionAllowance === 'number') {
        reactionAllowance = setReactionAllowance(ctx.db, {
          campaignId: ctx.campaignId,
          combatantId: a.combatantId,
          allowance: a.reactionAllowance,
          provenance: `model:${ctx.turnId}`,
          sessionId: ctx.sessionId,
          at: ctx.at,
        });
        if (!hasCombatantUpdate) {
          return ok({ reactionAllowance });
        }
      }
      const update = updateCombatant(ctx.db, {
        campaignId: ctx.campaignId,
        combatantId: a.combatantId,
        ...(typeof a.hpDelta === 'number' ? { hpDelta: a.hpDelta } : {}),
        ...(isRecord(a.addCondition)
          ? { addCondition: a.addCondition as CharacterConditionEntry }
          : {}),
        ...(typeof a.removeCondition === 'string'
          ? { removeCondition: a.removeCondition }
          : {}),
        ...(typeof a.status === 'string'
          ? { status: a.status as CombatantStatus }
          : {}),
        ...(typeof a.locationId === 'string'
          ? { locationId: a.locationId }
          : {}),
        ...(typeof a.placement === 'string' ? { placement: a.placement } : {}),
        provenance: `model:${ctx.turnId}`,
        sessionId: ctx.sessionId,
        at: ctx.at,
      });
      return ok(
        reactionAllowance === undefined
          ? update
          : { ...update, reactionAllowance },
      );
    } catch (e) {
      if (e instanceof EncounterCombatantError) {
        return err('invalid_target', e.message);
      }
      if (e instanceof ActionEconomyError) {
        return err('turn_budget_error', e.message);
      }
      throw e;
    }
  },
};
