import {
  type CombatInstanceStatus,
  closeCombatInstance,
  EncounterCombatantError,
} from '../state/encounterCombatants.js';
import type { Tool } from './toolRegistry.js';
import { asRecord, err, ok } from './toolRegistry.js';

const CLOSED_STATUSES: readonly Exclude<CombatInstanceStatus, 'active'>[] = [
  'completed',
  'abandoned',
  'fled',
  'interrupted',
];

export const closeCombatInstanceTool: Tool = {
  name: 'close_combat_instance',
  mutates: true,
  description:
    'Close the active combat instance so it cannot become active again. args: { status: "completed"|"abandoned"|"fled"|"interrupted", combatInstanceId?: string }.',
  inputSchema: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        enum: CLOSED_STATUSES,
        description:
          'Inactive lifecycle status to assign. Closed combat instances are historical only.',
      },
      combatInstanceId: {
        type: 'string',
        description:
          'Optional exact combat instance id. Omit to close the active instance for this session.',
        minLength: 1,
      },
    },
    required: ['status'],
    additionalProperties: false,
  },
  run(args, ctx) {
    const a = asRecord(args);
    if (
      a === undefined ||
      typeof a.status !== 'string' ||
      !CLOSED_STATUSES.includes(
        a.status as Exclude<CombatInstanceStatus, 'active'>,
      )
    ) {
      return err(
        'invalid_args',
        'close_combat_instance requires inactive status',
      );
    }
    if (
      a.combatInstanceId !== undefined &&
      typeof a.combatInstanceId !== 'string'
    ) {
      return err(
        'invalid_args',
        'close_combat_instance combatInstanceId must be a string',
      );
    }
    try {
      return ok(
        closeCombatInstance(ctx.db, {
          campaignId: ctx.campaignId,
          ...(typeof a.combatInstanceId === 'string'
            ? { combatInstanceId: a.combatInstanceId }
            : {}),
          status: a.status as Exclude<CombatInstanceStatus, 'active'>,
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
