import { getBundledDnd5eCharacterResolver } from '../character/rulesPackResolver.js';
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
      spell: {
        type: 'string',
        minLength: 1,
        description:
          'Spell name or canonical rules reference; its base level is resolved from the active rules pack.',
      },
      slotLevel: {
        type: 'integer',
        minimum: 1,
        maximum: 9,
        description: 'Optional selected slot level, for an intentional upcast.',
      },
      character: CHARACTER_TARGET_SCHEMA,
    },
    required: ['spell'],
    additionalProperties: false,
  },
  run(args, ctx) {
    const a = asRecord(args);
    if (a === undefined || typeof a.spell !== 'string') {
      return err('invalid_args', 'spend_spell_slot requires { spell }');
    }
    const target = resolveTargetCharacterId(a.character, ctx);
    if ('ok' in target) return target;
    const spell = getBundledDnd5eCharacterResolver().resolveSpell(a.spell);
    if (!spell.ok) {
      return err('invalid_spell', spell.message);
    }
    try {
      return ok(
        spendSpellSlot(ctx.db, {
          spellLevel: spell.record.level,
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
