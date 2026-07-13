/**
 * Shared schema fragments and parsing helpers for the F3 active-effect tools
 * (start_effect / end_effect / refresh_effect / remove_effect_target /
 * resolve_concentration), mirroring toolResolutionShared.ts for F9.
 */

import type { JsonSchema } from '../model/toolSchema.js';
import {
  CharacterResolutionError,
  resolveCharacterRef,
} from '../state/activeCharacter.js';
import type {
  EffectDurationInput,
  EffectParticipant,
} from '../state/activeEffects.js';
import { ActiveEffectError } from '../state/activeEffects.js';
import type { ToolContext, ToolResult } from './toolRegistry.js';
import { err } from './toolRegistry.js';

/** `{ kind, ref }` participant argument (character name/id or combatant id). */
export const EFFECT_PARTICIPANT_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['character', 'combatant'] },
    ref: {
      type: 'string',
      description: 'Character id or name, or encounter combatant id.',
      minLength: 1,
    },
  },
  required: ['kind', 'ref'],
  additionalProperties: false,
};

/** Typed duration argument; `kind` decides which other fields are required. */
export const EFFECT_DURATION_SCHEMA: JsonSchema = {
  type: 'object',
  description:
    'Typed duration. kind "timed" requires amount + unit + anchor; ' +
    '"until-trigger" requires trigger (the semantic event that ends the ' +
    'effect); "until-dismissed" requires the effect to be dismissible; ' +
    '"until-removed" is for until-dispelled/curse effects with no natural ' +
    'expiry. Round-unit timers need an active combat instance.',
  properties: {
    kind: {
      type: 'string',
      enum: ['timed', 'until-dismissed', 'until-removed', 'until-trigger'],
    },
    amount: { type: 'integer', minimum: 1 },
    unit: { type: 'string', enum: ['round', 'minute', 'hour', 'day'] },
    anchor: {
      type: 'string',
      enum: ['spell-cast', 'effect-created'],
      description:
        'What the timer counts from. "spell-cast" requires a spell source; ' +
        'turn-relative and trigger anchors are reserved until the F2 ' +
        'turn-boundary integration lands.',
    },
    trigger: {
      type: 'string',
      description: 'The named event that ends an until-trigger effect.',
      minLength: 1,
    },
  },
  required: ['kind'],
  additionalProperties: false,
};

/**
 * Resolve a `{ kind, ref }` participant argument: character refs accept the
 * same id-or-name forms the other character tools accept; combatant refs are
 * exact combatant ids (existence is validated by the state layer).
 */
export function resolveEffectParticipant(
  raw: unknown,
  ctx: ToolContext,
  label: string,
): EffectParticipant | ToolResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return err('invalid_args', `${label} must be a { kind, ref } object`);
  }
  const record = raw as Record<string, unknown>;
  const { kind, ref } = record;
  if (kind !== 'character' && kind !== 'combatant') {
    return err(
      'invalid_args',
      `${label}.kind must be 'character' or 'combatant'`,
    );
  }
  if (typeof ref !== 'string' || ref.length === 0) {
    return err('invalid_args', `${label}.ref must be a non-empty string`);
  }
  if (kind === 'combatant') {
    return { kind, ref };
  }
  try {
    return { kind, ref: resolveCharacterRef(ctx.db, ref) };
  } catch (e) {
    if (e instanceof CharacterResolutionError) {
      return err('invalid_target', `${label}: ${e.message}`);
    }
    throw e;
  }
}

/** Parse the flattened duration argument into the typed union. */
export function parseEffectDuration(
  raw: unknown,
): EffectDurationInput | ToolResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return err('invalid_args', 'duration must be a { kind, ... } object');
  }
  const record = raw as Record<string, unknown>;
  switch (record.kind) {
    case 'timed':
      if (
        typeof record.amount !== 'number' ||
        typeof record.unit !== 'string' ||
        typeof record.anchor !== 'string'
      ) {
        return err(
          'invalid_args',
          'a timed duration requires amount, unit, and anchor',
        );
      }
      // Enum membership is re-validated fail-closed by the state layer.
      return {
        kind: 'timed',
        amount: record.amount,
        unit: record.unit as 'round' | 'minute' | 'hour' | 'day',
        anchor: record.anchor as
          | 'spell-cast'
          | 'effect-created'
          | 'trigger-occurred'
          | 'source-turn-start'
          | 'target-turn-start',
      };
    case 'until-dismissed':
      return { kind: 'until-dismissed' };
    case 'until-removed':
      return { kind: 'until-removed' };
    case 'until-trigger':
      if (typeof record.trigger !== 'string' || record.trigger.length === 0) {
        return err(
          'invalid_args',
          'an until-trigger duration requires a non-empty trigger',
        );
      }
      return { kind: 'until-trigger', trigger: record.trigger };
    default:
      return err(
        'invalid_args',
        'duration.kind must be timed, until-dismissed, until-removed, or until-trigger',
      );
  }
}

/** Map state-layer failures to tool errors; rethrow programming errors. */
export function effectToolError(e: unknown): ToolResult {
  if (e instanceof ActiveEffectError) {
    return err('effect_error', e.message);
  }
  throw e;
}
