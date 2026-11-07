import { validateDeathSaveModifier } from '../state/combatantLifecycle.js';
import {
  EncounterCombatantError,
  resolveCombatantDeathSave,
} from '../state/encounterCombatants.js';
import { recordDeathSave } from '../state/hpLifecycle.js';
import { MutateStateError } from '../state/mutateState.js';
import {
  dmRollProvenanceSuffix,
  dmSuppliedRollEvidence,
  engineRollEvidence,
  type RollEvidence,
} from '../state/rollEvidence.js';
import { effectiveAdvantageState } from './resolution.js';
import type { Tool } from './toolRegistry.js';
import {
  asRecord,
  CHARACTER_TARGET_SCHEMA,
  err,
  ok,
  resolveTargetCharacterId,
} from './toolRegistry.js';
import {
  ADVANTAGE_SCHEMA,
  DISADVANTAGE_SCHEMA,
  parseVisibility,
  VISIBILITY_SCHEMA,
} from './toolResolutionShared.js';
import {
  isToolResult,
  parseRollOverride,
  ROLL_OVERRIDE_SCHEMA,
} from './toolRollOverride.js';

export const recordDeathSaveTool: Tool = {
  name: 'record_death_save',
  // Writes death-save counters and life state — a canon write (eshyra-dwkm).
  mutates: true,
  description:
    'Record a death save for a dying character or opted-in player-character combatant. The engine rolls the d20 from the seeded RNG (do not roll it yourself); declare advantage and/or disadvantage if an effect applies (both cancel; the kept die is the natural result). An optional saveBonus (integer -20 to 20) is added to the natural roll when judging the 10-or-higher success test; the DM decides which saving-throw effects apply (for example Bless, Aura of Protection, a Ring of Protection), rolls any bonus dice they add through `roll`, passes the total as saveBonus, and names the sources in bonusSources. The tool does not discover bonuses itself. A natural 1 is always two failures and a natural 20 always revives (subject to the usual blocks), regardless of saveBonus. Only to adjudicate a result the engine cannot roll (a ruling or house rule), supply `roll` together with `rollOverride { basis, reason, ruleId? }`; a supplied roll without rollOverride is refused, and advantage/disadvantage cannot accompany a supplied roll. The result carries rollEvidence (engine-rolled dice, or the recorded DM-supplied override) and, when player_visible, appears in the engine roll ledger. For a combatant, this works only during that combatant’s active combat instance; a dying player-character actor whose encounter closed continues its death saves and stabilization when it is next brought into an encounter with start_encounter.',
  inputSchema: {
    type: 'object',
    properties: {
      roll: {
        type: 'integer',
        description:
          'Omit to let the engine roll. A DM-supplied natural d20 result (1-20, unmodified); requires rollOverride.',
        minimum: 1,
        maximum: 20,
      },
      rollOverride: ROLL_OVERRIDE_SCHEMA,
      advantage: ADVANTAGE_SCHEMA,
      disadvantage: DISADVANTAGE_SCHEMA,
      visibility: VISIBILITY_SCHEMA,
      saveBonus: {
        type: 'integer',
        description:
          'Total saving-throw bonus from effects the DM has identified (integer -20 to 20, default 0). Added to the natural roll for the 10-or-higher test only; natural 1 and natural 20 ignore it.',
        minimum: -20,
        maximum: 20,
      },
      bonusSources: {
        type: 'array',
        description:
          'Names of the spells or features that supplied saveBonus (for example "Bless"), recorded with the result.',
        items: { type: 'string', minLength: 1 },
        maxItems: 8,
      },
      character: CHARACTER_TARGET_SCHEMA,
      combatantId: { type: 'string', minLength: 1 },
    },
    additionalProperties: false,
  },
  run(args, ctx) {
    const a = asRecord(args);
    if (a === undefined)
      return err('invalid_args', 'record_death_save requires an object');
    if (a.roll !== undefined && typeof a.roll !== 'number')
      return err(
        'invalid_args',
        'record_death_save roll must be an integer 1-20',
      );
    for (const flag of ['advantage', 'disadvantage'] as const)
      if (a[flag] !== undefined && typeof a[flag] !== 'boolean')
        return err(
          'invalid_args',
          `record_death_save ${flag} must be a boolean`,
        );
    let supplied: RollEvidence | undefined;
    let suffix = '';
    if (a.roll !== undefined) {
      if (a.advantage !== undefined || a.disadvantage !== undefined)
        return err(
          'invalid_args',
          'advantage/disadvantage apply to an engine roll; a supplied roll is the final natural result',
        );
      if (!Number.isInteger(a.roll) || a.roll < 1 || a.roll > 20)
        return err(
          'invalid_args',
          'record_death_save roll must be an integer 1-20',
        );
      if (a.rollOverride === undefined)
        return err(
          'invalid_args',
          'record_death_save rolls the d20 itself: omit roll, or supply roll together with rollOverride { basis, reason, ruleId? }',
        );
      const override = parseRollOverride(
        a.rollOverride,
        ctx,
        'record_death_save',
      );
      if (isToolResult(override)) return override;
      supplied = dmSuppliedRollEvidence(a.roll, override);
      suffix = dmRollProvenanceSuffix(override);
    } else if (a.rollOverride !== undefined) {
      return err(
        'invalid_args',
        'rollOverride applies only with a supplied roll; omit it to let the engine roll',
      );
    }
    if (a.character !== undefined && a.combatantId !== undefined)
      return err('invalid_args', 'provide character or combatantId, not both');
    const modifier = validateDeathSaveModifier(a.saveBonus, a.bonusSources);
    if (!modifier.ok) return err('invalid_args', modifier.message);
    const visibility = parseVisibility(a.visibility) ?? 'player_visible';
    const evidence: RollEvidence =
      supplied ??
      engineRollEvidence(
        {
          advantage: '2d20kh1',
          disadvantage: '2d20kl1',
          none: '1d20',
        }[
          effectiveAdvantageState(a.advantage === true, a.disadvantage === true)
        ],
        ctx.rng,
      );
    const roll = evidence.natural;
    const withMeta = (result: object) =>
      ok({
        ...result,
        reason: 'Death saving throw',
        category: 'death_save',
        visibility,
      });
    if (typeof a.combatantId === 'string') {
      try {
        return withMeta(
          resolveCombatantDeathSave(
            ctx.db,
            ctx.campaignId,
            a.combatantId,
            roll,
            {
              provenance: `model:${ctx.turnId}${suffix}`,
              sessionId: ctx.sessionId,
              at: ctx.at,
              resolveRulesPack: ctx.resolveRulesPack,
            },
            ctx.rng,
            {
              saveBonus: modifier.saveBonus,
              bonusSources: modifier.bonusSources,
            },
            evidence,
          ),
        );
      } catch (e) {
        if (e instanceof EncounterCombatantError)
          return err('mutate_error', e.message);
        throw e;
      }
    }
    const target = resolveTargetCharacterId(a.character, ctx);
    if ('ok' in target) {
      return target;
    }
    try {
      const result = recordDeathSave(
        ctx.db,
        roll,
        {
          provenance: `model:${ctx.turnId}${suffix}`,
          sessionId: ctx.sessionId,
          at: ctx.at,
          resolveRulesPack: ctx.resolveRulesPack,
          characterId: target.id,
        },
        ctx.rng,
        { saveBonus: modifier.saveBonus, bonusSources: modifier.bonusSources },
        evidence,
      );
      return withMeta(result);
    } catch (e) {
      if (e instanceof MutateStateError) {
        return err('mutate_error', e.message);
      }
      throw e;
    }
  },
};
