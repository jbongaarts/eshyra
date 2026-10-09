import { prepareSpellsAfterLongRest } from '../character/spellPreparation.js';
import type { Tool } from './toolRegistry.js';
import { asRecord, err, ok } from './toolRegistry.js';

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
      character: { type: 'string', minLength: 1 },
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
    const characterId =
      typeof a.character === 'string'
        ? a.character
        : (ctx.actingCharacterId ?? '');
    if (characterId.trim().length === 0) {
      return err(
        'invalid_target',
        'prepare_spells requires an acting character or character',
      );
    }
    try {
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
