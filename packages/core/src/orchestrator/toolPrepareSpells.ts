import { prepareSpellsAfterLongRest } from '../character/spellPreparation.js';
import { resolveCharacterId } from '../state/activeCharacter.js';
import type { Tool } from './toolRegistry.js';
import {
  asRecord,
  CHARACTER_TARGET_SCHEMA,
  err,
  ok,
  resolveTargetCharacterId,
} from './toolRegistry.js';

export const prepareSpellsTool: Tool = {
  name: 'prepare_spells',
  mutates: true,
  requiresExplicitAction: true,
  description:
    "Set a cleric's, druid's, paladin's or wizard's prepared spell list when they finish a long rest (the rules let them change it then). " +
    'Valid only for a completed long rest the character took part in, before world time advances. ' +
    'The engine enforces the class count (ability modifier + level; paladin half level; minimum 1), the class list at castable levels (wizard: spellbook only), ' +
    'and rejects duplicates and unknown spells. Domain/oath/circle spells are always prepared, are added by the engine, and do not count. ' +
    'Replaces the whole list. args: { restId: string, spells: string[], character?: string }.',
  inputSchema: {
    type: 'object',
    properties: {
      restId: { type: 'string', minLength: 1 },
      spells: {
        type: 'array',
        items: { type: 'string', minLength: 1 },
        minItems: 1,
      },
      character: CHARACTER_TARGET_SCHEMA,
    },
    required: ['restId', 'spells'],
    additionalProperties: false,
  },
  run(raw, ctx) {
    const a = asRecord(raw);
    if (
      !a ||
      typeof a.restId !== 'string' ||
      !Array.isArray(a.spells) ||
      a.spells.length === 0 ||
      a.spells.some((s) => typeof s !== 'string')
    ) {
      return err(
        'invalid_args',
        'prepare_spells requires restId and a non-empty spells string array',
      );
    }
    const target = resolveTargetCharacterId(a.character, ctx);
    if ('ok' in target) return target;
    try {
      const characterId = resolveCharacterId(ctx.db, target.id);
      return ok(
        prepareSpellsAfterLongRest(ctx.db, {
          campaignId: ctx.campaignId,
          characterId,
          restId: a.restId,
          spellRefs: a.spells as string[],
        }),
      );
    } catch (e) {
      return err(
        'preparation_error',
        e instanceof Error ? e.message : String(e),
      );
    }
  },
};
