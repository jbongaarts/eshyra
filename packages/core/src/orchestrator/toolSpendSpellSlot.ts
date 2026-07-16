import {
  CampaignRulesBindingResolutionError,
  lookupStrictCampaignRecord,
  lookupStrictCampaignRecordByName,
} from '../state/campaignRecordLookup.js';
import { SpellSlotError, spendSpellSlot } from '../state/spellSlots.js';
import { resolveSpellUpcast, SpellUpcastError } from './spellUpcast.js';
import type { Tool } from './toolRegistry.js';
import {
  asRecord,
  CHARACTER_TARGET_SCHEMA,
  err,
  ok,
  resolveTargetCharacterId,
} from './toolRegistry.js';

export const spendSpellSlotTool: Tool = {
  name: 'spend_spell_slot',
  mutates: true,
  description:
    'Spend a spell slot for a named spell cast. The spell’s base level is ' +
    'resolved from the active rules pack; cantrips are at will. A leveled spell ' +
    'requires an available slot at its level or higher; omit ' +
    'slotLevel to spend the lowest legal available slot, or pass a higher ' +
    'slotLevel for an intentional upcast. The same atomic operation validates ' +
    'and spends the slot and returns the canonical upcast scaling transform. ' +
    'The slot pool is derived from ' +
    'the character sheet, never declared by the model.',
  inputSchema: {
    type: 'object',
    properties: {
      spellRef: {
        type: 'string',
        minLength: 1,
        description:
          'Canonical spell reference; its base level is resolved from the active rules pack.',
      },
      spell: {
        type: 'string',
        minLength: 1,
        description:
          'Deprecated replay-compatible spell name. New calls must use spellRef.',
      },
      slotLevel: {
        type: 'integer',
        minimum: 1,
        maximum: 9,
        description: 'Optional selected slot level, for an intentional upcast.',
      },
      character: CHARACTER_TARGET_SCHEMA,
    },
    additionalProperties: false,
  },
  run(args, ctx) {
    const a = asRecord(args);
    if (a === undefined) {
      return err('invalid_args', 'spend_spell_slot requires { spellRef }');
    }
    const spellRef = a.spellRef;
    const legacySpell = a.spell;
    if (
      (typeof spellRef !== 'string' && typeof legacySpell !== 'string') ||
      (spellRef !== undefined && legacySpell !== undefined)
    ) {
      return err(
        'invalid_args',
        'spend_spell_slot requires exactly one of { spellRef } or legacy { spell }',
      );
    }
    const target = resolveTargetCharacterId(a.character, ctx);
    if ('ok' in target) return target;
    try {
      const spell =
        typeof spellRef === 'string'
          ? lookupStrictCampaignRecord(
              ctx.db,
              'spell',
              spellRef,
              ctx.resolveRulesPack,
            )
          : lookupStrictCampaignRecordByName(
              ctx.db,
              'spell',
              legacySpell as string,
              ctx.resolveRulesPack,
            );
      const requestedSpell =
        typeof spellRef === 'string' ? spellRef : (legacySpell as string);
      if (spell === undefined)
        return err(
          'invalid_spell',
          `spell '${requestedSpell}' does not resolve unambiguously in the campaign rules binding`,
        );
      const level =
        typeof spell.data === 'object' &&
        spell.data !== null &&
        !Array.isArray(spell.data)
          ? (spell.data as Record<string, unknown>).level
          : undefined;
      if (typeof level !== 'number')
        return err(
          'invalid_spell',
          'resolved spell record has no valid base level',
        );
      let upcast: ReturnType<typeof resolveSpellUpcast> | null = null;
      const spent = spendSpellSlot(ctx.db, {
        spellLevel: level,
        ...(typeof a.slotLevel === 'number' ? { slotLevel: a.slotLevel } : {}),
        ...(target.id === undefined ? {} : { characterId: target.id }),
        provenance: `model:${ctx.turnId}`,
        sessionId: ctx.sessionId,
        at: ctx.at,
        beforeSpend: (selectedSlotLevel) => {
          if (level !== 0) {
            upcast = resolveSpellUpcast(spell, selectedSlotLevel);
          }
        },
      });
      return ok({
        spellRef: spell.key,
        baseSpellLevel: level,
        selectedSlotLevel: spent.counter.spellLevel,
        pool: spent.counter.pool,
        ...spent,
        upcast,
      });
    } catch (e) {
      if (e instanceof CampaignRulesBindingResolutionError)
        return err('rules_binding_error', e.message);
      if (e instanceof SpellSlotError) {
        return err('spell_slot_error', e.message);
      }
      if (e instanceof SpellUpcastError)
        return err('spell_upcast_error', e.message);
      throw e;
    }
  },
};
