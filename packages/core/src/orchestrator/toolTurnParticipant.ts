import type { TurnParticipantInput } from '../state/actionEconomy.js';
import type { ToolContext, ToolResult } from './toolRegistry.js';
import {
  CHARACTER_TARGET_SCHEMA,
  err,
  resolveTargetCharacterId,
} from './toolRegistry.js';

/**
 * Shared arg parsing for the F2 turn-budget tools (begin_turn,
 * spend_turn_resource, set_surprised): a turn participant is either a live
 * encounter combatant (exact `combatantId`) or a party character
 * (`character` ref, defaulting to the acting character) — never both.
 */

/** JSON-schema fragments for the two mutually exclusive participant args. */
export const PARTICIPANT_SCHEMA_PROPERTIES = {
  combatantId: {
    type: 'string',
    description:
      'Exact combatant id from the active combatants context when the ' +
      'participant is a monster/NPC combatant. Mutually exclusive with ' +
      '`character`.',
    minLength: 1,
  },
  character: CHARACTER_TARGET_SCHEMA,
} as const;

/**
 * Parse the participant args off a tool call. Returns a
 * {@link TurnParticipantInput} (character ref may be undefined, meaning the
 * acting character) or an error {@link ToolResult} to hand back to the model.
 */
export function parseTurnParticipant(
  args: Record<string, unknown>,
  ctx: ToolContext,
  toolName: string,
): TurnParticipantInput | ToolResult {
  if (args.combatantId !== undefined && args.character !== undefined) {
    return err(
      'invalid_args',
      `${toolName} takes combatantId OR character, not both`,
    );
  }
  if (args.combatantId !== undefined) {
    if (typeof args.combatantId !== 'string' || args.combatantId.length === 0) {
      return err(
        'invalid_args',
        `${toolName} combatantId must be a non-empty string`,
      );
    }
    return { kind: 'combatant', ref: args.combatantId };
  }
  const target = resolveTargetCharacterId(args.character, ctx);
  if ('ok' in target) {
    return target;
  }
  return {
    kind: 'character',
    ...(target.id === undefined ? {} : { ref: target.id }),
  };
}
