import {
  BONDED_SUMMON_TRIGGERS,
  transitionBondedSummon,
} from '../state/activeEffects.js';
import { effectToolError } from './toolEffectShared.js';
import type { Tool } from './toolRegistry.js';
import { asRecord, err, ok } from './toolRegistry.js';

export const transitionBondedSummonTool: Tool = {
  name: 'transition_bonded_summon',
  // Executes a bonded spell's action-triggered presence transition (eshyra-82uk).
  mutates: true,
  description:
    'Execute an action-triggered presence transition that a bonded-summon ' +
    'spell declares (Find Familiar, Find Steed) while its bond (the effect ' +
    'and its actor link) stays active. The bond must have been created ' +
    'from its spell (start_effect source { kind: "spell", ref }) and ' +
    'spellRef must be that spell; a ruling-sourced bond is refused. The ' +
    'spell record’s transition for the trigger, the creature’s modelled ' +
    'presence (present = alive, in its pocket dimension = pocketed, ' +
    'absent) and the active link decide the result, never the spell’s name. ' +
    'Triggers: action-temporary-dismissal (a present familiar disappears ' +
    'into its pocket dimension: it leaves play and any combat instance but ' +
    'keeps its hit points and conditions; status pocketed); action-recall ' +
    '(a pocketed familiar reappears in an unoccupied space within 30 feet ' +
    'of the caster: it returns alive with the hit points and conditions it ' +
    'had and, while a combat instance is active, enters it as a NEW ' +
    'combatant row; side is required then when it has no earlier ' +
    'combatant in that instance, faction and placement are optional, and ' +
    'where it appears is narrated, not tracked); action-dismissal (Find ' +
    'Steed: a present steed disappears and stays bonded; cast the spell ' +
    'again with recast_bonded_summon to restore it at its hit point ' +
    'maximum); action-permanent-dismissal (Find Familiar: dismissed ' +
    'forever from present or pocketed) and action-release (Find Steed: ' +
    'released from the bond from present or absent) take the creature out ' +
    'of play, close its link and end the effect (reason dismissed): such a ' +
    'creature can return only as a new creature from a new cast ' +
    '(start_effect, then start_encounter). Permanent dismissal of a ' +
    'familiar that already vanished at 0 hit points is refused: the source ' +
    'is ambiguous about it. A pocketed creature takes no part in combat and ' +
    'cannot be changed or admitted by start_encounter until recalled. This ' +
    'spends NO action: in combat spend the caster’s action with ' +
    'spend_turn_resource. A recalled familiar rolls its own initiative; ' +
    'initiative is narrated, not tracked. Refused when the effect ended or ' +
    'is suppressed, or the spell has no transition for that trigger and ' +
    'presence. Nothing changes when a call is refused.',
  inputSchema: {
    type: 'object',
    properties: {
      effectId: {
        type: 'string',
        minLength: 1,
        description: 'The bonded summoning effect holding the creature’s link.',
      },
      spellRef: {
        type: 'string',
        minLength: 1,
        description:
          'The spell record that created the bond (e.g. "spell:find-familiar").',
      },
      trigger: {
        type: 'string',
        enum: [...BONDED_SUMMON_TRIGGERS],
        description: 'The action taken on the bonded creature.',
      },
      side: {
        type: 'string',
        minLength: 1,
        description:
          'Recall into an active combat instance only: the side of a creature that has no combatant there yet.',
      },
      faction: {
        type: 'string',
        minLength: 1,
        description:
          'Recall into an active combat instance only: optional faction.',
      },
      placement: {
        type: 'string',
        minLength: 1,
        description:
          'Recall into an active combat instance only: optional narrated placement.',
      },
    },
    required: ['effectId', 'spellRef', 'trigger'],
    additionalProperties: false,
  },
  run(args, ctx) {
    const a = asRecord(args);
    const optional = (v: unknown) => v === undefined || typeof v === 'string';
    if (
      a === undefined ||
      typeof a.effectId !== 'string' ||
      typeof a.spellRef !== 'string' ||
      typeof a.trigger !== 'string' ||
      !(BONDED_SUMMON_TRIGGERS as readonly string[]).includes(a.trigger) ||
      !optional(a.side) ||
      !optional(a.faction) ||
      !optional(a.placement)
    ) {
      return err(
        'invalid_args',
        `transition_bonded_summon requires { effectId, spellRef, trigger (one of ${BONDED_SUMMON_TRIGGERS.join(', ')}), side?, faction?, placement? }`,
      );
    }
    try {
      return ok(
        transitionBondedSummon(ctx.db, {
          campaignId: ctx.campaignId,
          effectId: a.effectId,
          spellRef: a.spellRef,
          trigger: a.trigger as (typeof BONDED_SUMMON_TRIGGERS)[number],
          ...(a.side === undefined ? {} : { side: a.side as string }),
          ...(a.faction === undefined ? {} : { faction: a.faction as string }),
          ...(a.placement === undefined
            ? {}
            : { placement: a.placement as string }),
          ...(ctx.resolveRulesPack === undefined
            ? {}
            : { resolveRulesPack: ctx.resolveRulesPack }),
          provenance: `model:${ctx.turnId}`,
          sessionId: ctx.sessionId,
          at: ctx.at,
        }),
      );
    } catch (e) {
      return effectToolError(e);
    }
  },
};
