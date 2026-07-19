import { updateClock } from '../state/domainMutations.js';
import { MutateStateError } from '../state/mutateState.js';
import type { Tool } from './toolRegistry.js';
import { asRecord, err, ok } from './toolRegistry.js';

export const updateClockTool: Tool = {
  name: 'update_clock',
  // Writes the session clock — a canon write (eshyra-dwkm).
  mutates: true,
  description:
    "Update the in-game clock and/or the character's current location.",
  inputSchema: {
    type: 'object',
    properties: {
      in_game_time: {
        type: 'string',
        description: 'New in-game time (e.g. "Day 3, late afternoon").',
      },
      location_id: {
        type: ['string', 'null'],
        minLength: 1,
        description:
          'Location identifier to move the character to. Set to null to clear.',
      },
    },
    additionalProperties: false,
  },
  run(args, ctx) {
    const a = asRecord(args);
    if (a === undefined) {
      return err(
        'invalid_args',
        'update_clock requires at least one of in_game_time or location_id',
      );
    }
    const inGameTime =
      typeof a.in_game_time === 'string' ? a.in_game_time : undefined;
    const locationId =
      typeof a.location_id === 'string' || a.location_id === null
        ? (a.location_id as string | null)
        : undefined;

    if (typeof locationId === 'string' && locationId.trim().length === 0) {
      return err(
        'invalid_args',
        'update_clock location_id must contain a non-whitespace character or be null',
      );
    }

    if (inGameTime === undefined && locationId === undefined) {
      return err(
        'invalid_args',
        'update_clock requires at least one of in_game_time or location_id',
      );
    }
    try {
      updateClock(
        ctx.db,
        { inGameTime, locationId },
        {
          provenance: `model:${ctx.turnId}`,
          sessionId: ctx.sessionId,
          at: ctx.at,
        },
      );
      return ok({
        applied: true,
        in_game_time: inGameTime,
        location_id: locationId,
      });
    } catch (e) {
      if (e instanceof MutateStateError) {
        return err('mutate_error', e.message);
      }
      throw e;
    }
  },
};
