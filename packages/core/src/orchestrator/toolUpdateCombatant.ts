import {
  ActionEconomyError,
  type SetReactionAllowanceResult,
  setReactionAllowance,
} from '../state/actionEconomy.js';
import {
  concentrationSaveDc,
  getConcentrationEffect,
} from '../state/activeEffects.js';
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
    'Update a live encounter combatant by exact combatant id. args: { combatantId: string, hpDelta?: integer, addCondition?: {id:string,...}, removeCondition?: string, status?: "alive"|"dead"|"unconscious"|"escaped"|"inactive", locationId?: string, placement?: string, reactionAllowance?: integer }. reactionAllowance stores a reactions-per-round total only for a creature whose rules record carries a state-dependent extraReactions mechanic, and is refused for other creatures. Neither this tool nor any other derives that total from the current state of the creature (for example the Reactive Heads of a hydra), and that state is not tracked, so the extra reactions such a mechanic grants cannot currently be recorded. An hpDelta that brings the combatant to 0 hit points sets its status to dead unless status is also passed (for example "unconscious" for a nonlethal knockout); combatants have no dying or death-save state.',
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
          'A reactions-per-round total to store, accepted only for a ' +
          'creature whose rules record grants state-dependent extra ' +
          'reactions. The engine checks only that the record grants them; ' +
          'it does not derive the total or check it against the ' +
          "creature's state, and no tool derives it.",
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
      // F3 concentration reactions. The incapacitation/death break happened
      // INSIDE updateCombatant's transaction (never here — the tool only
      // reports it); a combatant damaged but still up owes the save.
      let concentration:
        | { broken: unknown }
        | { checkRequired: unknown }
        | undefined;
      const downed =
        update.combatant.hpCurrent === 0 ||
        update.combatant.status === 'dead' ||
        update.combatant.status === 'unconscious';
      if (update.concentrationBroken !== undefined) {
        concentration = { broken: update.concentrationBroken };
      } else if (!downed && typeof a.hpDelta === 'number' && a.hpDelta < 0) {
        const live = getConcentrationEffect(ctx.db, ctx.campaignId, {
          kind: 'combatant',
          ref: a.combatantId,
        });
        if (live !== undefined) {
          concentration = {
            checkRequired: {
              effectId: live.effectId,
              displayName: live.displayName,
              dc: concentrationSaveDc(-a.hpDelta),
              damage: -a.hpDelta,
            },
          };
        }
      }
      return ok({
        ...update,
        ...(reactionAllowance === undefined ? {} : { reactionAllowance }),
        ...(concentration === undefined ? {} : { concentration }),
      });
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
