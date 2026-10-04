import { ActionEconomyError } from '../state/actionEconomy.js';
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
  'dying',
  'stable',
  'absent',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const updateCombatantTool: Tool = {
  name: 'update_combatant',
  mutates: true,
  description:
    'Update a live encounter combatant by exact combatant id. args: { combatantId, hpDelta?, damageTypes?, critical?, deathRules?, addCondition?, removeCondition?, status?, locationId?, placement? }. A dead combatant stays dead in both death-rule modes: it cannot be healed and a non-dead status is refused. Monster death rules are the default: an hpDelta that brings the combatant to 0 hit points sets it dead unless status is also passed (for a nonlethal knockout, "unconscious"). That knockout is hit points 0 with status unconscious and no death, but any further damage to the knocked-out monster kills it; "stable" is refused for monsters. damageTypes declares the types in the resolve_damage result for a negative hpDelta. For creatures with tracked heads, the engine tracks head loss and regrowth; extra reactions derive from the current head count. deathRules: "player-character" opts the combatant into the character death rules for good: reaching 0 hit points makes it dying (dead outright when the damage beyond 0 reaches its effective hit point maximum), damage at 0 hit points adds a death-save failure (two when critical is true), healing from 0 returns it to alive, and a nonlethal knockout is passed as status "stable" together with that damage. Otherwise "dying" and "stable" are engine-owned and refused as explicit statuses. addCondition cannot add exhaustion; use adjust_exhaustion to change exhaustion levels. Status "absent" means out of play under a rule and is engine-owned: it is refused as an explicit status, and an absent combatant takes no turn and cannot be damaged, healed, or given or relieved of conditions; it returns only through a new start_encounter admission that supplies hit points above 0. A creature whose spell says it disappears when it drops to 0 hit points (the conjure spells, Simulacrum, or an owned creature declared atZeroHitPoints "vanish" or "vanish-bonded") becomes absent when hpDelta brings it to 0 hit points, never dead, dying, stable, or unconscious, and the result reports vanished. Under "vanish" its owning link closes (the effect ends when no owned creature remains); under "vanish-bonded" (familiar, steed) the link and effect stay active and the result reports linkKept. For such a creature a knockout (status "unconscious" or "stable" with damage to 0) is refused, as is any other status passed with damage that brings it to 0 (pass the hpDelta alone), and deathRules "player-character" is refused, as it is for any creature owned by an effect with a "remove" cleanup policy (that effect must be able to take it out of play).',
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
      damageTypes: {
        type: 'array',
        items: { type: 'string' },
        description: 'Damage types from resolve_damage for negative hpDelta.',
      },
      deathRules: {
        type: 'string',
        enum: ['player-character'],
        description:
          'One-way opt-in to player-character death rules for this combatant. Refused for a creature whose spell says it disappears (or reverts) at 0 hit points, and for a creature owned by an effect with a "remove" cleanup policy: such a creature must be able to leave play and so can never be dying or stable.',
      },
      critical: {
        type: 'boolean',
        description: 'Damage at 0 HP was a critical hit.',
      },
      addCondition: {
        type: 'object',
        description:
          'Condition object to add. Must include a non-empty id; extra JSON fields are preserved. Exhaustion is refused here; use adjust_exhaustion.',
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
    try {
      const update = updateCombatant(ctx.db, {
        campaignId: ctx.campaignId,
        combatantId: a.combatantId,
        ...(typeof a.hpDelta === 'number' ? { hpDelta: a.hpDelta } : {}),
        ...(Array.isArray(a.damageTypes)
          ? {
              damageTypes: a.damageTypes.filter(
                (v): v is string => typeof v === 'string',
              ),
            }
          : {}),
        resolveRulesPack: ctx.resolveRulesPack,
        ...(a.deathRules === 'player-character'
          ? { deathRules: 'player-character' as const }
          : {}),
        ...(typeof a.critical === 'boolean' ? { critical: a.critical } : {}),
        rng: ctx.rng,
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
        update.combatant.status === 'unconscious' ||
        update.combatant.status === 'absent';
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
        ...(update.vanished === undefined
          ? {}
          : {
              vanished: {
                ...update.vanished,
                message:
                  `${update.combatant.displayLabel} dropped to 0 hit points and disappeared (its spell's zero-hit-point rule): it is now absent, out of play, not dead` +
                  (update.vanished.effectId === null
                    ? '.'
                    : update.vanished.linkKept
                      ? `; it stays bonded: its link to effect '${update.vanished.effectId}' and that effect remain active, so the same creature can return.`
                      : update.vanished.effectEnded
                        ? `; its link to effect '${update.vanished.effectId}' closed and that effect ended (source-removed) because no owned creature remains.`
                        : `; its link to effect '${update.vanished.effectId}' closed and that effect continues.`),
              },
            }),
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
