import { ActionEconomyError, beginTurn } from '../state/actionEconomy.js';
import type { Tool } from './toolRegistry.js';
import { asRecord, err, ok } from './toolRegistry.js';
import {
  PARTICIPANT_SCHEMA_PROPERTIES,
  parseTurnParticipant,
} from './toolTurnParticipant.js';

export const beginTurnTool: Tool = {
  name: 'begin_turn',
  // Writes the combat instance's turn marker and the budget row (eshyra-dwkm).
  mutates: true,
  description:
    "Begin a combatant or party character's turn in the active combat " +
    "instance. Resets that participant's per-turn budget (action, bonus " +
    'action, free object interaction, movement note) and returns their ' +
    'reaction; implicitly ends the previous turn (clearing its surprise) and ' +
    'automatically settles due F3 round and participant-turn effects. ' +
    'Call once per participant per turn in initiative order. Pass round when ' +
    'a new combat round starts; it never decreases. args: { combatantId?: ' +
    'string, character?: string, round?: integer }.',
  inputSchema: {
    type: 'object',
    properties: {
      ...PARTICIPANT_SCHEMA_PROPERTIES,
      round: {
        type: 'integer',
        description:
          'Current combat round (1-based). Pass when the round advances; ' +
          'omit to stay in the current round.',
        minimum: 1,
      },
    },
    additionalProperties: false,
  },
  run(args, ctx) {
    const a = asRecord(args);
    if (a === undefined) {
      return err('invalid_args', 'begin_turn requires an object');
    }
    if (a.round !== undefined && typeof a.round !== 'number') {
      return err('invalid_args', 'begin_turn round must be an integer');
    }
    const participant = parseTurnParticipant(a, ctx, 'begin_turn');
    if ('ok' in participant) {
      return participant;
    }
    try {
      return ok(
        beginTurn(ctx.db, {
          campaignId: ctx.campaignId,
          participant,
          ...(typeof a.round === 'number' ? { round: a.round } : {}),
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
