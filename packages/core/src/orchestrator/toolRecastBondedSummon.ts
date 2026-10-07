import { recastBondedSummon } from '../state/activeEffects.js';
import { effectToolError } from './toolEffectShared.js';
import type { Tool } from './toolRegistry.js';
import { asRecord, err, ok } from './toolRegistry.js';

export const recastBondedSummonTool: Tool = {
  name: 'recast_bonded_summon',
  // Restores an absent bonded creature through its spell's recast (eshyra-s02z).
  mutates: true,
  description:
    'Record that the summoner casts a bonded-summon spell again (Find ' +
    'Familiar, Find Steed) to bring back its creature that disappeared at 0 ' +
    'hit points while the bond (the effect and its actor link) stayed active. ' +
    'The spell record’s cast-again transition decides the result: ' +
    'a spell that restores the same creature at maximum hit points (Find ' +
    'Steed) takes NO form and returns the same actor alive at its effective ' +
    'hit point maximum; a spell that lets the creature adopt a form on its ' +
    'return (Find Familiar) REQUIRES form, one of the creature refs the ' +
    'spell lists (the same form as before is allowed), and the same actor ' +
    'returns in that form with that creature’s hit points. Nothing else ' +
    'about the actor changes. Refused: when the creature is present or ' +
    'pocketed (reforming it is not yet supported), when the effect ended or ' +
    'the bond was released (a new cast then creates a new creature: ' +
    'start_effect, then start_encounter), when the effect is suppressed, ' +
    'and while the creature still has a combatant in an active combat ' +
    'instance (these spells take 10 minutes or more to cast, so close the ' +
    'combat instance first). This spends no spell slot: spend it separately ' +
    'with spend_spell_slot (or cast the ritual) as the spell requires. ' +
    'Afterwards start_encounter admits the creature normally.',
  inputSchema: {
    type: 'object',
    properties: {
      effectId: {
        type: 'string',
        minLength: 1,
        description: 'The bonded summoning effect holding the creature’s link.',
      },
      spellRef: {
        type: 'string',
        minLength: 1,
        description: 'The spell record cast again (e.g. "spell:find-steed").',
      },
      form: {
        type: 'string',
        minLength: 1,
        description:
          'Creature ref of the new form (e.g. "creature:owl"); only for a spell that lets the creature adopt a form.',
      },
    },
    required: ['effectId', 'spellRef'],
    additionalProperties: false,
  },
  run(args, ctx) {
    const a = asRecord(args);
    if (
      a === undefined ||
      typeof a.effectId !== 'string' ||
      typeof a.spellRef !== 'string' ||
      (a.form !== undefined && typeof a.form !== 'string')
    ) {
      return err(
        'invalid_args',
        'recast_bonded_summon requires { effectId, spellRef, form? }',
      );
    }
    try {
      return ok(
        recastBondedSummon(ctx.db, {
          campaignId: ctx.campaignId,
          effectId: a.effectId,
          spellRef: a.spellRef,
          ...(a.form === undefined ? {} : { form: a.form }),
          ...(ctx.resolveRulesPack === undefined
            ? {}
            : { resolveRulesPack: ctx.resolveRulesPack }),
          provenance: `model:${ctx.turnId}`,
          sessionId: ctx.sessionId,
          at: ctx.at,
        }),
      );
    } catch (e) {
      return effectToolError(e);
    }
  },
};
