import { recastBondedSummon } from '../state/activeEffects.js';
import { effectToolError } from './toolEffectShared.js';
import type { Tool } from './toolRegistry.js';
import { asRecord, err, ok } from './toolRegistry.js';

export const recastBondedSummonTool: Tool = {
  name: 'recast_bonded_summon',
  // Restores an absent / reforms a present bonded creature via its spell's recast (eshyra-s02z, eshyra-71u1).
  mutates: true,
  description:
    'Record that the summoner casts a bonded-summon spell again (Find ' +
    'Familiar, Find Steed) while the bond (the effect and its actor link) ' +
    'stays active. The bond must have been created from its spell ' +
    '(start_effect source { kind: "spell", ref }) and spellRef must be that ' +
    'spell; a ruling-sourced bond is refused. The creature’s modelled presence and the spell record’s ' +
    'cast-again transition decide the result. An ABSENT creature (it ' +
    'disappeared at 0 hit points) is restored: a spell that restores the ' +
    'same creature at maximum hit points (Find Steed) takes NO form and ' +
    'returns the same actor alive at its effective hit point maximum; a ' +
    'spell that lets the creature adopt a form (Find Familiar) REQUIRES ' +
    'form, one of the creature refs the spell lists (the same form as before ' +
    'is allowed), and the same actor returns in that form with that ' +
    'creature’s hit points. A PRESENT creature is reformed when the spell ' +
    'has a cast-again transition for it: a recast of Find Familiar while the ' +
    'familiar is present REQUIRES form, and the same actor stays present in ' +
    'the new form with that creature’s hit points (damage does not carry ' +
    'across; the exhaustion-adjusted maximum applies). The engine does not ' +
    'track a familiar dismissed to its pocket dimension: such a familiar is ' +
    'recorded as present, and the reform has the same effect. A present Find ' +
    'Steed is refused. Nothing else about the actor changes. Refused: when ' +
    'the effect ended or the bond was released (a new cast then creates a ' +
    'new creature: start_effect, then start_encounter), when the effect is ' +
    'suppressed, and while the creature still has a combatant in an active ' +
    'combat instance (these spells take 10 minutes or more to cast, so close ' +
    'the combat instance first). This spends no spell slot: spend it ' +
    'separately with spend_spell_slot (or cast the ritual) as the spell ' +
    'requires. ' +
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
