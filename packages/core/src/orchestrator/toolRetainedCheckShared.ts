import { randomUUID } from 'node:crypto';
import type { JsonSchema } from '../model/toolSchema.js';
import type { ToolContext } from './toolRegistry.js';
import { asRecord, resolveTargetCharacterId } from './toolRegistry.js';

export const PARTICIPANT_SCHEMA: JsonSchema = {
  anyOf: [
    {
      type: 'object',
      properties: { character: { type: 'string', minLength: 1 } },
      required: ['character'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: { combatantId: { type: 'string', minLength: 1 } },
      required: ['combatantId'],
      additionalProperties: false,
    },
  ],
};

export interface ParticipantIdentity {
  kind: 'character' | 'combatant';
  ref: string;
}

export function parseParticipant(
  value: unknown,
  ctx: ToolContext,
): ParticipantIdentity | undefined {
  if (value === undefined) return undefined;
  const participant = asRecord(value);
  if (participant === undefined)
    throw new Error('participant must be an object');
  const keys = Object.keys(participant);
  if (keys.length !== 1)
    throw new Error('participant must identify one character or combatant');
  if (
    typeof participant.character === 'string' &&
    participant.character.length > 0
  ) {
    const resolved = resolveTargetCharacterId(participant.character, ctx);
    if ('code' in resolved) throw new Error(resolved.message);
    if (!('id' in resolved) || resolved.id === undefined)
      throw new Error('participant character could not be resolved');
    return { kind: 'character', ref: resolved.id };
  }
  if (
    typeof participant.combatantId === 'string' &&
    participant.combatantId.length > 0
  ) {
    const exists = ctx.db
      .prepare(`SELECT 1 FROM encounter_combatant ec
      JOIN combat_instance ci ON ci.campaign_id = ec.campaign_id
        AND ci.combat_instance_id = ec.combat_instance_id
      WHERE ec.campaign_id = ? AND ec.combatant_id = ? AND ci.status = 'active'`)
      .get(ctx.campaignId, participant.combatantId);
    if (exists === undefined)
      throw new Error(
        'participant combatantId must identify a combatant in the active combat instance',
      );
    return { kind: 'combatant', ref: participant.combatantId };
  }
  throw new Error('participant must contain character or combatantId');
}

export function newId(): string {
  return randomUUID();
}
