import {
  CampaignRulesBindingResolutionError,
  lookupStrictCampaignRecord,
} from '../state/campaignRecordLookup.js';
import { resolveSpellUpcast, SpellUpcastError } from './spellUpcast.js';
import type { Tool } from './toolRegistry.js';
import { asRecord, err, ok } from './toolRegistry.js';

export const resolveSpellUpcastTool: Tool = {
  name: 'resolve_spell_upcast',
  mutates: false,
  description:
    'Resolve the source-bound deterministic changes for a canonical spell cast in a selected slot. This computes scaling only; it does not roll, spend, target, or apply effects.',
  inputSchema: {
    type: 'object',
    properties: {
      spellRef: {
        type: 'string',
        minLength: 1,
        description:
          'Canonical spell record reference, for example spell:fireball.',
      },
      slotLevel: { type: 'integer', minimum: 1, maximum: 9 },
    },
    required: ['spellRef', 'slotLevel'],
    additionalProperties: false,
  },
  run(args, ctx) {
    const a = asRecord(args);
    if (
      a === undefined ||
      typeof a.spellRef !== 'string' ||
      typeof a.slotLevel !== 'number'
    )
      return err(
        'invalid_args',
        'resolve_spell_upcast requires { spellRef, slotLevel }',
      );
    try {
      const lookup = lookupStrictCampaignRecord(
        ctx.db,
        'spell',
        a.spellRef,
        ctx.resolveRulesPack,
      );
      if (lookup === undefined)
        return err(
          'invalid_spell',
          `canonical spell reference '${a.spellRef}' does not resolve in the campaign rules binding`,
        );
      return ok(resolveSpellUpcast(lookup, a.slotLevel));
    } catch (error) {
      if (error instanceof CampaignRulesBindingResolutionError)
        return err('rules_binding_error', error.message);
      if (error instanceof SpellUpcastError)
        return err('spell_upcast_error', error.message);
      throw error;
    }
  },
};
