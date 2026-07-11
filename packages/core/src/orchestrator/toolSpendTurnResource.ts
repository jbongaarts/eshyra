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
];

export const spendTurnResourceTool: Tool = {
  name: 'spend_turn_resource',
  // Writes the participant's turn-budget record (eshyra-dwkm).
  mutates: true,
  description:
    "Spend a participant's action-economy budget in the active combat " +
    'instance: their action, bonus action, reaction (once per round, usable ' +
    'off-turn), free object interaction, or movement (a narrative note, not ' +
    'a numeric budget). The engine refuses double-spends, off-turn spends of ' +
    'on-turn resources, and any spend by a surprised participant. When the ' +
    'spend casts a spell, pass spell:{cantrip} so the bonus-action-spell ' +
    'rule is enforced (a bonus-action spell restricts every other spell that ' +
    'turn to an action cantrip). args: { resource: "action"|"bonus_action"|' +
    '"reaction"|"free_interaction"|"movement", activity: string, ' +
    'combatantId?: string, character?: string, spell?: { cantrip: boolean } }.',
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
      spell: {
        type: 'object',
        description:
          'Present iff this spend casts a spell. cantrip: whether the spell ' +
          'is a cantrip (casting time is implied by the resource spent).',
        properties: {
          cantrip: { type: 'boolean' },
        },
        required: ['cantrip'],
        additionalProperties: false,
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
    let spell: { cantrip: boolean } | undefined;
    if (a.spell !== undefined) {
      const s = asRecord(a.spell);
      if (s === undefined || typeof s.cantrip !== 'boolean') {
        return err(
          'invalid_args',
          'spend_turn_resource spell must be { cantrip: boolean }',
        );
      }
      spell = { cantrip: s.cantrip };
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
          ...(spell === undefined ? {} : { spell }),
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
