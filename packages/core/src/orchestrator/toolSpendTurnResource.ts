import {
  ActionEconomyError,
  spendTurnResource,
  type TurnResource,
} from '../state/actionEconomy.js';
import type { Tool } from './toolRegistry.js';
import { asRecord, err, ok } from './toolRegistry.js';
import {
  PARTICIPANT_SCHEMA_PROPERTIES,
  parseTurnParticipant,
} from './toolTurnParticipant.js';

const TURN_RESOURCES: readonly TurnResource[] = [
  'action',
  'bonus_action',
  'reaction',
  'free_interaction',
  'movement',
  'legendary_action',
];

export const spendTurnResourceTool: Tool = {
  name: 'spend_turn_resource',
  // Writes the participant's turn-budget record (eshyra-dwkm).
  mutates: true,
  description:
    "Spend a participant's action-economy budget in the active combat " +
    'instance: their action, bonus action, reaction (per-round allowance, ' +
    'usable off-turn), free object interaction, movement (a narrative ' +
    'note, not a numeric budget), or legendary action (legendary ' +
    "creatures only, spendable only on OTHER creatures' turns; pass " +
    'legendaryActionName so the cost comes from the record). The engine ' +
    'refuses over-budget spends, off-turn spends of on-turn resources, ' +
    'and any spend by a surprised participant. When the spend casts a ' +
    'spell, pass spellRef (the spell record key, e.g. ' +
    '"spell:healing-word"); the engine resolves it and enforces the ' +
    'bonus-action-spell rule (a bonus-action spell restricts every other ' +
    'spell that turn to a cantrip with a 1-action casting time). A cast ' +
    'without a spellRef is refused. args: { resource: ' +
    '"action"|"bonus_action"|"reaction"|"free_interaction"|"movement"|' +
    '"legendary_action", activity: string, combatantId?: string, ' +
    'character?: string, spellRef?: string, legendaryActionName?: string }.',
  inputSchema: {
    type: 'object',
    properties: {
      resource: {
        type: 'string',
        enum: TURN_RESOURCES,
        description: 'Which budget slot this spend consumes.',
      },
      activity: {
        type: 'string',
        description:
          'What the spend was, e.g. "Attack (shortsword)", "cast Healing ' +
          'Word", "opportunity attack vs goblin-1", "moved 20 ft to the door".',
        minLength: 1,
      },
      ...PARTICIPANT_SCHEMA_PROPERTIES,
      spellRef: {
        type: 'string',
        description:
          'Present iff this spend casts a spell: the spell record key from ' +
          'the rules pack, e.g. "spell:fire-bolt". The engine derives ' +
          'cantrip status and casting time from the record.',
        minLength: 1,
      },
      legendaryActionName: {
        type: 'string',
        description:
          'For a legendary_action spend: the legendary option used, as the ' +
          'statblock prints it (e.g. "Wing Attack"). The engine derives ' +
          'the action cost (1 unless the option says "Costs N Actions") ' +
          'from the record.',
        minLength: 1,
      },
    },
    required: ['resource', 'activity'],
    additionalProperties: false,
  },
  run(args, ctx) {
    const a = asRecord(args);
    if (
      a === undefined ||
      typeof a.resource !== 'string' ||
      typeof a.activity !== 'string'
    ) {
      return err(
        'invalid_args',
        'spend_turn_resource requires { resource, activity }',
      );
    }
    if (!TURN_RESOURCES.includes(a.resource as TurnResource)) {
      return err(
        'invalid_args',
        `spend_turn_resource resource must be one of: ${TURN_RESOURCES.join(', ')}`,
      );
    }
    if (
      a.spellRef !== undefined &&
      (typeof a.spellRef !== 'string' || a.spellRef.length === 0)
    ) {
      return err(
        'invalid_args',
        'spend_turn_resource spellRef must be a non-empty spell record key like "spell:fire-bolt"',
      );
    }
    if (
      a.legendaryActionName !== undefined &&
      (typeof a.legendaryActionName !== 'string' ||
        a.legendaryActionName.length === 0)
    ) {
      return err(
        'invalid_args',
        'spend_turn_resource legendaryActionName must be a non-empty option name like "Wing Attack"',
      );
    }
    const participant = parseTurnParticipant(a, ctx, 'spend_turn_resource');
    if ('ok' in participant) {
      return participant;
    }
    try {
      return ok(
        spendTurnResource(ctx.db, {
          campaignId: ctx.campaignId,
          participant,
          resource: a.resource as TurnResource,
          activity: a.activity,
          ...(typeof a.spellRef === 'string' ? { spellRef: a.spellRef } : {}),
          ...(typeof a.legendaryActionName === 'string'
            ? { legendaryActionName: a.legendaryActionName }
            : {}),
          resolveRulesPack: ctx.resolveRulesPack,
          provenance: `model:${ctx.turnId}`,
          sessionId: ctx.sessionId,
          at: ctx.at,
        }),
      );
    } catch (e) {
      if (e instanceof ActionEconomyError) {
        return err('turn_budget_error', e.message);
      }
      throw e;
    }
  },
};
