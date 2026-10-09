import { CampaignRulesBindingResolutionError } from '../state/campaignRecordLookup.js';
import {
  FlexibleCastingError,
  flexibleCasting,
} from '../state/flexibleCasting.js';
import { SpellSlotError } from '../state/spellSlots.js';
import { UsageCounterError } from '../state/usageCounters.js';
import type { Tool } from './toolRegistry.js';
import {
  asRecord,
  CHARACTER_TARGET_SCHEMA,
  err,
  ok,
  resolveTargetCharacterId,
} from './toolRegistry.js';

export const flexibleCastingTool: Tool = {
  name: 'flexible_casting',
  mutates: true,
  description:
    'Sorcerer Flexible Casting (level 2+): "create-slot" spends sorcery ' +
    'points for a new spell slot of slotLevel 1-5 (it vanishes at the next ' +
    'long rest), "convert-slot" expends an available slot of slotLevel to ' +
    'regain that many sorcery points (never above the maximum). Costs and ' +
    'limits come from the rules pack; the engine refuses an unaffordable or ' +
    'illegal request. Both take a bonus action, which this tool does not ' +
    'consume: track it with the turn-resource tool in combat. Created slots ' +
    'are spent before ordinary ones by spend_spell_slot.',
  inputSchema: {
    type: 'object',
    properties: {
      operation: { type: 'string', enum: ['create-slot', 'convert-slot'] },
      slotLevel: { type: 'integer', minimum: 1, maximum: 9 },
      character: CHARACTER_TARGET_SCHEMA,
    },
    required: ['operation', 'slotLevel'],
    additionalProperties: false,
  },
  run(args, ctx) {
    const a = asRecord(args);
    if (
      a === undefined ||
      (a.operation !== 'create-slot' && a.operation !== 'convert-slot') ||
      typeof a.slotLevel !== 'number' ||
      !Number.isInteger(a.slotLevel)
    ) {
      return err(
        'invalid_args',
        'flexible_casting requires { operation: "create-slot"|"convert-slot", slotLevel: integer }',
      );
    }
    const target = resolveTargetCharacterId(a.character, ctx);
    if ('ok' in target) return target;
    try {
      return ok(
        flexibleCasting(ctx.db, {
          campaignId: ctx.campaignId,
          operation: a.operation,
          slotLevel: a.slotLevel,
          ...(target.id === undefined ? {} : { characterId: target.id }),
          ...(ctx.resolveRulesPack === undefined
            ? {}
            : { resolveRulesPack: ctx.resolveRulesPack }),
          provenance: `model:${ctx.turnId}`,
          sessionId: ctx.sessionId,
          at: ctx.at,
        }),
      );
    } catch (e) {
      if (e instanceof CampaignRulesBindingResolutionError)
        return err('rules_binding_error', e.message);
      if (e instanceof FlexibleCastingError)
        return err('flexible_casting_error', e.message);
      if (e instanceof SpellSlotError)
        return err('spell_slot_error', e.message);
      if (e instanceof UsageCounterError) return err('usage_error', e.message);
      throw e;
    }
  },
};
