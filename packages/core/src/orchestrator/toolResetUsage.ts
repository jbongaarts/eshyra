import type { TurnParticipantInput } from '../state/actionEconomy.js';
import type { UsageResetEvent } from '../state/usageCounters.js';
import { resetUsage, UsageCounterError } from '../state/usageCounters.js';
import type { Tool } from './toolRegistry.js';
import { asRecord, err, ok } from './toolRegistry.js';
import {
  PARTICIPANT_SCHEMA_PROPERTIES,
  parseTurnParticipant,
} from './toolTurnParticipant.js';

const RESET_EVENTS: readonly UsageResetEvent[] = [
  'short_rest',
  'long_rest',
  'dawn',
];

export const resetUsageTool: Tool = {
  name: 'reset_usage',
  // Writes durable usage-counter records (eshyra-dwkm).
  mutates: true,
  description:
    'Apply a usage reset event after narrating it: a short rest, a long ' +
    'rest, or dawn. Rests restore rest-recharge economies and Recharge ' +
    'X-Y abilities (long rests also cover short-rest economies); dawn ' +
    'restores per-day economies (X/Day, innate per-day spells, and legacy/ad-hoc unbound item charges). Canonical pack-bound item economies are owned by the deterministic item reset executor (see docs/item-reset-executor.md), not generic usage counters. By default a rest applies to every character (the party ' +
    'rests); pass combatantId or character to scope the event to one ' +
    'owner. Dawn applies to everyone. Items that regain a rolled amount ' +
    '("1d6+1 daily at dawn") are returned in needsRolledRestore instead ' +
    'of being reset — roll the formula via `roll`, then apply it with ' +
    'restore_usage. args: { event: "short_rest"|"long_rest"|"dawn", ' +
    'combatantId?: string, character?: string }.',
  inputSchema: {
    type: 'object',
    properties: {
      event: {
        type: 'string',
        enum: RESET_EVENTS,
        description: 'Which reset event occurred.',
      },
      ...PARTICIPANT_SCHEMA_PROPERTIES,
    },
    required: ['event'],
    additionalProperties: false,
  },
  run(args, ctx) {
    const a = asRecord(args);
    if (a === undefined || typeof a.event !== 'string') {
      return err('invalid_args', 'reset_usage requires { event }');
    }
    if (!RESET_EVENTS.includes(a.event as UsageResetEvent)) {
      return err(
        'invalid_args',
        `reset_usage event must be one of: ${RESET_EVENTS.join(', ')}`,
      );
    }
    // Scope is optional: only parse an owner when one was named. (The
    // character arg defaulting to the acting PC would otherwise narrow
    // every party rest to one character.)
    let owner: TurnParticipantInput | undefined;
    if (a.combatantId !== undefined || a.character !== undefined) {
      const parsed = parseTurnParticipant(a, ctx, 'reset_usage');
      if ('ok' in parsed) {
        return parsed;
      }
      owner = parsed;
    }
    try {
      return ok(
        resetUsage(ctx.db, {
          campaignId: ctx.campaignId,
          event: a.event as UsageResetEvent,
          ...(owner === undefined ? {} : { owner }),
          provenance: `model:${ctx.turnId}`,
          sessionId: ctx.sessionId,
          at: ctx.at,
        }),
      );
    } catch (e) {
      if (e instanceof UsageCounterError) {
        return err('usage_error', e.message);
      }
      throw e;
    }
  },
};
