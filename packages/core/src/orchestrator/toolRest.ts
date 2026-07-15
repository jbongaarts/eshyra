import {
  advanceWorldTime,
  completeLongRest,
  completeShortRest,
  finishShortRestRecovery,
  spendRestHitDie,
} from '../state/rest.js';
import type { Tool } from './toolRegistry.js';
import { asRecord, err, ok } from './toolRegistry.js';

const shortQualification = {
  type: 'object',
  properties: {
    durationMinutes: { type: 'integer', minimum: 0 },
    strenuousActivity: { type: 'boolean' },
  },
  required: ['durationMinutes'],
  additionalProperties: false,
} as const;
const longQualification = {
  type: 'object',
  properties: {
    durationMinutes: { type: 'integer', minimum: 0 },
    sleepMinutes: { type: 'integer', minimum: 0 },
    lightActivityMinutes: { type: 'integer', minimum: 0 },
    strenuousInterruptionMinutes: { type: 'integer', minimum: 0 },
    foodAndDrink: { type: 'boolean' },
  },
  required: [
    'durationMinutes',
    'sleepMinutes',
    'lightActivityMinutes',
    'strenuousInterruptionMinutes',
    'foodAndDrink',
  ],
  additionalProperties: false,
} as const;
const participantRestProperties = {
  restId: { type: 'string', minLength: 1 },
  participants: {
    type: 'array',
    items: { type: 'string', minLength: 1 },
    minItems: 1,
  },
  in_game_time_label: { type: 'string' },
} as const;
function args(a: Record<string, unknown> | undefined) {
  if (
    !a ||
    typeof a.restId !== 'string' ||
    !Array.isArray(a.participants) ||
    !a.qualification ||
    typeof a.qualification !== 'object'
  )
    return undefined;
  return a;
}
export const advanceTimeTool: Tool = {
  name: 'advance_time',
  mutates: true,
  requiresExplicitAction: true,
  description:
    'Advance structured in-game time by a positive number of minutes. This is the canonical time operation; update_clock labels never fabricate elapsed time.',
  inputSchema: {
    type: 'object',
    properties: {
      minutes: { type: 'integer', minimum: 1 },
      in_game_time_label: { type: 'string' },
    },
    required: ['minutes'],
    additionalProperties: false,
  },
  run(raw, ctx) {
    const a = asRecord(raw);
    if (!a || typeof a.minutes !== 'number')
      return err(
        'invalid_args',
        'advance_time requires positive integer minutes',
      );
    try {
      return ok(
        advanceWorldTime(ctx.db, {
          campaignId: ctx.campaignId,
          minutes: a.minutes,
          inGameTimeLabel:
            typeof a.in_game_time_label === 'string'
              ? a.in_game_time_label
              : undefined,
          provenance: `model:${ctx.turnId}`,
          sessionId: ctx.sessionId,
          at: ctx.at,
        }),
      );
    } catch (e) {
      return err('rest_error', e instanceof Error ? e.message : String(e));
    }
  },
};
function restTool(name: string, kind: 'short' | 'long'): Tool {
  return {
    name,
    mutates: true,
    requiresExplicitAction: true,
    description:
      kind === 'short'
        ? 'Complete one group short rest, advancing the clock once. It restores Pact Magic, not ordinary Spellcasting slots, and opens one-at-a-time Hit Die recovery.'
        : 'Complete one group long rest after code validation: at least 8 hours, and no more than once per 24 in-game hours. Dawn is not a long rest.',
    inputSchema: {
      type: 'object',
      properties: {
        ...participantRestProperties,
        qualification:
          kind === 'short' ? shortQualification : longQualification,
      },
      required: ['restId', 'participants', 'qualification'],
      additionalProperties: false,
    },
    run(raw, ctx) {
      const a = args(asRecord(raw));
      if (!a)
        return err(
          'invalid_args',
          `${name} requires restId, participants, and qualification`,
        );
      try {
        const input = {
          campaignId: ctx.campaignId,
          restId: a.restId as string,
          participants: a.participants as string[],
          qualification: a.qualification as never,
          inGameTimeLabel:
            typeof a.in_game_time_label === 'string'
              ? a.in_game_time_label
              : undefined,
          provenance: `model:${ctx.turnId}`,
          sessionId: ctx.sessionId,
          at: ctx.at,
        };
        return ok(
          kind === 'short'
            ? completeShortRest(ctx.db, input)
            : completeLongRest(ctx.db, input),
        );
      } catch (e) {
        return err('rest_error', e instanceof Error ? e.message : String(e));
      }
    },
  };
}
export const completeShortRestTool = restTool('complete_short_rest', 'short');
export const completeLongRestTool = restTool('complete_long_rest', 'long');
export const spendRestHitDieTool: Tool = {
  name: 'spend_rest_hit_die',
  mutates: true,
  requiresExplicitAction: true,
  description:
    'Spend exactly one Hit Die for a completed short rest. The engine rolls 1dHitDie internally, applies canonical Constitution, and returns full dice evidence; the player may stop after any die.',
  inputSchema: {
    type: 'object',
    properties: { restId: { type: 'string' }, character: { type: 'string' } },
    required: ['restId'],
    additionalProperties: false,
  },
  run(raw, ctx) {
    const a = asRecord(raw);
    if (!a || typeof a.restId !== 'string')
      return err('invalid_args', 'spend_rest_hit_die requires restId');
    try {
      return ok(
        spendRestHitDie(ctx.db, {
          campaignId: ctx.campaignId,
          restId: a.restId,
          characterId:
            typeof a.character === 'string'
              ? a.character
              : (ctx.actingCharacterId ?? ''),
          rng: ctx.rng,
          provenance: `model:${ctx.turnId}`,
          sessionId: ctx.sessionId,
          at: ctx.at,
        }),
      );
    } catch (e) {
      return err('rest_error', e instanceof Error ? e.message : String(e));
    }
  },
};
export const finishShortRestRecoveryTool: Tool = {
  name: 'finish_short_rest_recovery',
  mutates: true,
  requiresExplicitAction: true,
  description:
    'Close a short-rest Hit Die recovery window so further Hit Die spending is rejected.',
  inputSchema: {
    type: 'object',
    properties: {
      restId: { type: 'string', minLength: 1 },
      character: { type: 'string', minLength: 1 },
    },
    required: ['restId'],
    additionalProperties: false,
  },
  run(raw, ctx) {
    const a = asRecord(raw);
    if (!a || typeof a.restId !== 'string')
      return err('invalid_args', 'finish_short_rest_recovery requires restId');
    try {
      const characterId =
        typeof a.character === 'string'
          ? a.character
          : (ctx.actingCharacterId ?? '');
      if (characterId.trim().length === 0)
        return err(
          'invalid_target',
          'finish_short_rest_recovery requires an acting character or character',
        );
      finishShortRestRecovery(ctx.db, ctx.campaignId, a.restId, characterId, {
        provenance: `model:${ctx.turnId}`,
        sessionId: ctx.sessionId,
        at: ctx.at,
      });
      return ok({ restId: a.restId, characterId, closed: true });
    } catch (e) {
      return err('rest_error', e instanceof Error ? e.message : String(e));
    }
  },
};
