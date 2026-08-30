import {
  EncounterCombatantError,
  type StartEncounterActorInput,
  startEncounter,
} from '../state/encounterCombatants.js';
import type { Tool } from './toolRegistry.js';
import { asRecord, err, ok } from './toolRegistry.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseActors(value: unknown): StartEncounterActorInput[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return undefined;
  const actors: StartEncounterActorInput[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.actorId !== 'string') {
      return undefined;
    }
    actors.push({
      actorId: item.actorId,
      ...(typeof item.displayName === 'string'
        ? { displayName: item.displayName }
        : {}),
      ...(typeof item.actorKind === 'string'
        ? { actorKind: item.actorKind as StartEncounterActorInput['actorKind'] }
        : {}),
      ...(typeof item.sourceKind === 'string'
        ? {
            sourceKind:
              item.sourceKind as StartEncounterActorInput['sourceKind'],
          }
        : {}),
      ...(typeof item.sourceRef === 'string'
        ? { sourceRef: item.sourceRef }
        : {}),
      ...(typeof item.rulesRef === 'string' ? { rulesRef: item.rulesRef } : {}),
      ...(Number.isInteger(item.hpCurrent)
        ? { hpCurrent: item.hpCurrent as number }
        : {}),
      ...(Number.isInteger(item.hpMax) ? { hpMax: item.hpMax as number } : {}),
      ...(Array.isArray(item.conditions)
        ? {
            conditions:
              item.conditions as StartEncounterActorInput['conditions'],
          }
        : {}),
      ...(typeof item.status === 'string'
        ? { status: item.status as StartEncounterActorInput['status'] }
        : {}),
      ...(typeof item.currentLocationId === 'string'
        ? { currentLocationId: item.currentLocationId }
        : {}),
      ...(isRecord(item.state)
        ? { state: item.state as StartEncounterActorInput['state'] }
        : {}),
      ...(typeof item.side === 'string' ? { side: item.side } : {}),
      ...(typeof item.faction === 'string' ? { faction: item.faction } : {}),
      ...(typeof item.placement === 'string'
        ? { placement: item.placement }
        : {}),
    });
  }
  return actors;
}

export const startEncounterTool: Tool = {
  name: 'start_encounter',
  mutates: true,
  description:
    'Start a new live combat instance from an authored encounter template and optional persistent actors. args: { encounterId?: string, combatInstanceId?: string, runId?: string, locationId?: string, actors?: [...] }.',
  inputSchema: {
    type: 'object',
    properties: {
      encounterId: {
        type: 'string',
        description:
          'Optional adventure module encounter/template id to instantiate into live combatant state.',
        minLength: 1,
      },
      combatInstanceId: {
        type: 'string',
        description:
          'Optional explicit campaign-unique combat instance id. Omit unless the id is already known.',
        minLength: 1,
      },
      runId: {
        type: 'string',
        description:
          'Optional active adventure run id when multiple runs could contain the same encounter id.',
        minLength: 1,
      },
      locationId: {
        type: 'string',
        description:
          'Optional current tactical location for this combat instance.',
        minLength: 1,
      },
      actors: {
        type: 'array',
        description:
          'Optional persistent actor projections to include in combat. Use explicit actorId/rulesRef for named or recurring NPCs/monsters.',
        items: {
          type: 'object',
          properties: {
            actorId: { type: 'string', minLength: 1 },
            displayName: { type: 'string', minLength: 1 },
            actorKind: {
              type: 'string',
              enum: ['npc', 'creature', 'monster', 'companion', 'other'],
            },
            sourceKind: {
              type: 'string',
              enum: [
                'module_npc',
                'module_creature',
                'encounter_instance',
                'campaign_created',
              ],
            },
            sourceRef: { type: 'string', minLength: 1 },
            rulesRef: { type: 'string', minLength: 1 },
            hpCurrent: { type: 'integer', minimum: 0 },
            hpMax: { type: 'integer', minimum: 0 },
            conditions: { type: 'array', items: { type: 'object' } },
            status: {
              type: 'string',
              enum: [
                'alive',
                'dead',
                'unconscious',
                'escaped',
                'inactive',
                'unknown',
              ],
            },
            currentLocationId: { type: 'string', minLength: 1 },
            state: { type: 'object', additionalProperties: true },
            side: { type: 'string', minLength: 1 },
            faction: { type: 'string', minLength: 1 },
            placement: { type: 'string', minLength: 1 },
          },
          required: ['actorId'],
          additionalProperties: false,
        },
      },
    },
    additionalProperties: false,
  },
  run(args, ctx) {
    const a = asRecord(args);
    if (a === undefined) {
      return err('invalid_args', 'start_encounter requires an object');
    }
    if (a.encounterId !== undefined && typeof a.encounterId !== 'string') {
      return err(
        'invalid_args',
        'start_encounter encounterId must be a string',
      );
    }
    if (
      a.combatInstanceId !== undefined &&
      typeof a.combatInstanceId !== 'string'
    ) {
      return err(
        'invalid_args',
        'start_encounter combatInstanceId must be a string',
      );
    }
    if (a.runId !== undefined && typeof a.runId !== 'string') {
      return err('invalid_args', 'start_encounter runId must be a string');
    }
    if (a.locationId !== undefined && typeof a.locationId !== 'string') {
      return err('invalid_args', 'start_encounter locationId must be a string');
    }
    const actors = parseActors(a.actors);
    if (a.actors !== undefined && actors === undefined) {
      return err('invalid_args', 'start_encounter actors are invalid');
    }
    if (a.encounterId === undefined && (actors?.length ?? 0) === 0) {
      return err(
        'invalid_args',
        'start_encounter requires encounterId or at least one actor',
      );
    }
    try {
      return ok(
        startEncounter(ctx.db, {
          campaignId: ctx.campaignId,
          ...(typeof a.encounterId === 'string'
            ? { encounterId: a.encounterId }
            : {}),
          ...(typeof a.combatInstanceId === 'string'
            ? { combatInstanceId: a.combatInstanceId }
            : {}),
          ...(typeof a.runId === 'string' ? { runId: a.runId } : {}),
          ...(typeof a.locationId === 'string'
            ? { locationId: a.locationId }
            : {}),
          ...(actors === undefined ? {} : { actors }),
          resolveAdventureModule: ctx.resolveAdventureModule,
          resolveRulesPack: ctx.resolveRulesPack,
          provenance: `model:${ctx.turnId}`,
          sessionId: ctx.sessionId,
          at: ctx.at,
        }),
      );
    } catch (e) {
      if (e instanceof EncounterCombatantError) {
        return err('combatant_error', e.message);
      }
      throw e;
    }
  },
};
