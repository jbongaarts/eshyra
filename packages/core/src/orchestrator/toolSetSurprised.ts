import {
  ActionEconomyError,
  setSurprised,
  type TurnParticipantInput,
} from '../state/actionEconomy.js';
import type { Tool } from './toolRegistry.js';
import { asRecord, err, ok, resolveTargetCharacterId } from './toolRegistry.js';

export const setSurprisedTool: Tool = {
  name: 'set_surprised',
  // Writes surprise flags onto turn-budget rows (eshyra-dwkm).
  mutates: true,
  description:
    'Record which participants are surprised at the start of the active ' +
    'combat instance, after you adjudicate the Stealth-vs-passive-Perception ' +
    'determination. A surprised participant cannot move or act on its first ' +
    'turn and cannot take a reaction until that turn ends — the engine ' +
    'enforces this; begin_turn clears the flag when the surprised turn ends. ' +
    "Call before any surprised participant's first turn. args: { " +
    'combatantIds?: string[], characters?: string[] }.',
  inputSchema: {
    type: 'object',
    properties: {
      combatantIds: {
        type: 'array',
        description:
          'Surprised monster/NPC combatants, by exact combatant id from the ' +
          'active combatants context.',
        items: { type: 'string', minLength: 1 },
      },
      characters: {
        type: 'array',
        description: 'Surprised party members, by id or name.',
        items: { type: 'string', minLength: 1 },
      },
    },
    additionalProperties: false,
  },
  run(args, ctx) {
    const a = asRecord(args);
    if (a === undefined) {
      return err('invalid_args', 'set_surprised requires an object');
    }
    const isStringArray = (value: unknown): value is string[] =>
      Array.isArray(value) &&
      value.every((item) => typeof item === 'string' && item.length > 0);
    if (a.combatantIds !== undefined && !isStringArray(a.combatantIds)) {
      return err(
        'invalid_args',
        'set_surprised combatantIds must be an array of non-empty strings',
      );
    }
    if (a.characters !== undefined && !isStringArray(a.characters)) {
      return err(
        'invalid_args',
        'set_surprised characters must be an array of non-empty strings',
      );
    }
    const participants: TurnParticipantInput[] = (
      isStringArray(a.combatantIds) ? a.combatantIds : []
    ).map((ref): TurnParticipantInput => ({ kind: 'combatant', ref }));
    for (const characterRef of isStringArray(a.characters)
      ? a.characters
      : []) {
      const target = resolveTargetCharacterId(characterRef, ctx);
      if ('ok' in target) {
        return target;
      }
      participants.push({
        kind: 'character',
        ...(target.id === undefined ? {} : { ref: target.id }),
      });
    }
    if (participants.length === 0) {
      return err(
        'invalid_args',
        'set_surprised needs at least one combatantId or character',
      );
    }
    try {
      return ok(
        setSurprised(ctx.db, {
          campaignId: ctx.campaignId,
          participants,
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
