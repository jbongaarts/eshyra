import { lookupStrictCampaignRecord } from '../state/campaignRecordLookup.js';
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
    'slotLevel for an intentional upcast. This only validates and spends the ' +
    'slot; F9 owns the upcast scaling transform. The slot pool is derived from ' +
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
      slotLevel: {
        type: 'integer',
        minimum: 1,
        maximum: 9,
        description: 'Optional selected slot level, for an intentional upcast.',
      },
      character: CHARACTER_TARGET_SCHEMA,
    },
    required: ['spellRef'],
    additionalProperties: false,
  },
  run(args, ctx) {
    const a = asRecord(args);
    if (a === undefined) {
      return err('invalid_args', 'spend_spell_slot requires { spellRef }');
    }
    const spellRef = a.spellRef;
    if (typeof spellRef !== 'string')
      return err('invalid_args', 'spend_spell_slot requires { spellRef }');
    const target = resolveTargetCharacterId(a.character, ctx);
    if ('ok' in target) return target;
    const spell = lookupStrictCampaignRecord(ctx.db, 'spell', spellRef);
    if (spell === undefined)
      return err(
        'invalid_spell',
        `spell reference '${spellRef}' does not resolve in the campaign rules binding`,
      );
    try {
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
      const spent = spendSpellSlot(ctx.db, {
        spellLevel: level,
        ...(typeof a.slotLevel === 'number' ? { slotLevel: a.slotLevel } : {}),
        ...(target.id === undefined ? {} : { characterId: target.id }),
        provenance: `model:${ctx.turnId}`,
        sessionId: ctx.sessionId,
        at: ctx.at,
      });
      const upcast =
        level === 0
          ? null
          : resolveSpellUpcast(spell, spent.counter.spellLevel);
      return ok({
        spellRef: spell.key,
        baseSpellLevel: level,
        selectedSlotLevel: spent.counter.spellLevel,
        pool: spent.counter.pool,
        ...spent,
        upcast,
      });
    } catch (e) {
      if (e instanceof SpellSlotError) {
        return err('spell_slot_error', e.message);
      }
      if (e instanceof SpellUpcastError)
        return err('spell_upcast_error', e.message);
      throw e;
    }
  },
};
