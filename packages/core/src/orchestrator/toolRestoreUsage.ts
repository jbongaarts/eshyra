import { dmRollProvenanceSuffix } from '../state/rollEvidence.js';
import { restoreUsage, UsageCounterError } from '../state/usageCounters.js';
import type { Tool } from './toolRegistry.js';
import { asRecord, err, ok } from './toolRegistry.js';
import { parseVisibility, VISIBILITY_SCHEMA } from './toolResolutionShared.js';
import {
  isToolResult,
  parseRollOverride,
  ROLL_OVERRIDE_SCHEMA,
} from './toolRollOverride.js';
import {
  PARTICIPANT_SCHEMA_PROPERTIES,
  parseTurnParticipant,
} from './toolTurnParticipant.js';

export const restoreUsageTool: Tool = {
  name: 'restore_usage',
  // Writes the owner's durable usage-counter record (eshyra-dwkm).
  mutates: true,
  description:
    'Restore a spent limited-use ability or legacy/ad-hoc unbound item charges; canonical pack-bound items use use_item and their semantic reset owner. Two modes: (1) ' +
    "recharge roll — at the start of the creature's turn, call with the " +
    "ability and neither roll nor amount: the engine rolls the counter's " +
    'recharge die from the seeded RNG (do not roll it yourself) and recharges ' +
    "the ability iff the roll meets the record's threshold (e.g. 5-6). Only to " +
    'adjudicate a result the engine cannot roll, supply `roll` together with ' +
    '`rollOverride { basis: "dm-adjudicated"|"house-rule", reason, ruleId? }`; a ' +
    'supplied roll without rollOverride is refused. (2) amount — regain a ' +
    'specific number of uses/charges that you decide (e.g. the "1d6+1" dawn ' +
    'recharge of a wand rolled via `roll`, or a DM ruling); the amount is ' +
    'DM-supplied and is not verified. Pass at most one of roll or amount. ' +
    'Rest/dawn resets go through reset_usage instead. args: { ' +
    'ability?: string, itemId?: string, combatantId?: string, character?: ' +
    'string, roll?: integer, rollOverride?: object, amount?: integer, ' +
    'visibility?: string }.',
  inputSchema: {
    type: 'object',
    properties: {
      ability: {
        type: 'string',
        description:
          'Ability name as the statblock prints it, e.g. "Fire Breath". ' +
          'Omit for item-charge restores.',
        minLength: 1,
      },
      itemId: {
        type: 'string',
        description: 'Inventory item id for item-charge restores.',
        minLength: 1,
      },
      ...PARTICIPANT_SCHEMA_PROPERTIES,
      roll: {
        type: 'integer',
        description:
          'DM-supplied natural recharge-die result for a Recharge X-Y ' +
          'ability; requires rollOverride. Omit to let the engine roll.',
        minimum: 1,
      },
      rollOverride: ROLL_OVERRIDE_SCHEMA,
      visibility: {
        ...VISIBILITY_SCHEMA,
        description:
          'Visibility of an engine recharge roll in the roll ledger (default dm_only).',
      },
      amount: {
        type: 'integer',
        description:
          'Uses/charges regained, as decided by the DM (not verified).',
        minimum: 1,
      },
    },
    additionalProperties: false,
  },
  run(args, ctx) {
    const a = asRecord(args) ?? {};
    if (a.ability !== undefined && typeof a.ability !== 'string') {
      return err('invalid_args', 'restore_usage ability must be a string');
    }
    if (a.itemId !== undefined && typeof a.itemId !== 'string') {
      return err('invalid_args', 'restore_usage itemId must be a string');
    }
    if (a.ability === undefined && a.itemId === undefined) {
      return err(
        'invalid_args',
        'restore_usage requires ability (statblock name) or itemId',
      );
    }
    if (a.roll !== undefined && typeof a.roll !== 'number') {
      return err('invalid_args', 'restore_usage roll must be an integer');
    }
    if (a.amount !== undefined && typeof a.amount !== 'number') {
      return err('invalid_args', 'restore_usage amount must be an integer');
    }
    let override: ReturnType<typeof parseRollOverride> | undefined;
    if (a.roll !== undefined) {
      if (a.rollOverride === undefined)
        return err(
          'invalid_args',
          'restore_usage rolls the recharge die itself: omit roll, or supply roll together with rollOverride { basis, reason, ruleId? }',
        );
      if (a.amount !== undefined)
        return err('invalid_args', 'pass at most one of roll or amount');
      override = parseRollOverride(a.rollOverride, ctx, 'restore_usage');
      if (isToolResult(override)) return override;
    } else if (a.rollOverride !== undefined) {
      return err(
        'invalid_args',
        'rollOverride applies only with a supplied roll; omit it to let the engine roll',
      );
    }
    const owner = parseTurnParticipant(a, ctx, 'restore_usage');
    if ('ok' in owner) {
      return owner;
    }
    const visibility = parseVisibility(a.visibility) ?? 'dm_only';
    const rollOverride =
      override !== undefined && !isToolResult(override) ? override : undefined;
    try {
      const result = restoreUsage(ctx.db, {
        campaignId: ctx.campaignId,
        owner,
        ...(typeof a.ability === 'string' ? { ability: a.ability } : {}),
        ...(typeof a.itemId === 'string' ? { itemId: a.itemId } : {}),
        ...(typeof a.roll === 'number' ? { roll: a.roll } : {}),
        ...(typeof a.amount === 'number' ? { amount: a.amount } : {}),
        ...(a.roll === undefined ? { rng: ctx.rng } : {}),
        ...(rollOverride === undefined ? {} : { rollOverride }),
        provenance: `model:${ctx.turnId}${rollOverride === undefined ? '' : dmRollProvenanceSuffix(rollOverride)}`,
        sessionId: ctx.sessionId,
        at: ctx.at,
        resolveRulesPack: ctx.resolveRulesPack,
      });
      return ok(
        result.rollEvidence === undefined
          ? result
          : {
              ...result,
              reason: 'Recharge roll',
              category: 'other',
              visibility,
            },
      );
    } catch (e) {
      if (e instanceof UsageCounterError) {
        return err('usage_error', e.message);
      }
      throw e;
    }
  },
};
