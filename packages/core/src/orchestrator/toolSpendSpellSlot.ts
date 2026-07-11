import { SpellSlotError, spendSpellSlot } from '../state/spellSlots.js';
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
    'Spend a spell slot for a spell cast. Cantrips (spellLevel 0) are at will. ' +
    'A leveled spell requires an available slot at its level or higher; omit ' +
    'slotLevel to spend the lowest legal available slot, or pass a higher ' +
    'slotLevel for an intentional upcast. This only validates and spends the ' +
    'slot; F9 owns the upcast scaling transform. The slot pool is derived from ' +
    'the character sheet, never declared by the model.',
  inputSchema: {
    type: 'object',
    properties: {
      spellLevel: {
        type: 'integer',
        minimum: 0,
        maximum: 9,
        description:
          'The spell’s base level; 0 is a cantrip and spends no slot.',
      },
      slotLevel: {
        type: 'integer',
        minimum: 1,
        maximum: 9,
        description: 'Optional selected slot level, for an intentional upcast.',
      },
      character: CHARACTER_TARGET_SCHEMA,
    },
    required: ['spellLevel'],
    additionalProperties: false,
  },
  run(args, ctx) {
    const a = asRecord(args);
    if (a === undefined || typeof a.spellLevel !== 'number') {
      return err('invalid_args', 'spend_spell_slot requires { spellLevel }');
    }
    const target = resolveTargetCharacterId(a.character, ctx);
    if ('ok' in target) return target;
    try {
      return ok(
        spendSpellSlot(ctx.db, {
          spellLevel: a.spellLevel,
          ...(typeof a.slotLevel === 'number'
            ? { slotLevel: a.slotLevel }
            : {}),
          ...(target.id === undefined ? {} : { characterId: target.id }),
          provenance: `model:${ctx.turnId}`,
          sessionId: ctx.sessionId,
          at: ctx.at,
        }),
      );
    } catch (e) {
      if (e instanceof SpellSlotError) {
        return err('spell_slot_error', e.message);
      }
      throw e;
    }
  },
};
