import type { Db } from '../persistence/db.js';
import { withTransaction } from '../persistence/db.js';
import { resolveCharacterId } from './activeCharacter.js';
import type { DomainMutationContext } from './domainMutations.js';
import { readCombatant, updateCombatant } from './encounterCombatants.js';
import {
  effectiveHpMax,
  exhaustionLevel,
  withExhaustionLevel,
} from './exhaustion.js';
import { applyCharacterExhaustionChanged } from './hpLifecycle.js';
import { MutateStateError } from './mutateState.js';

export interface AdjustExhaustionInput extends DomainMutationContext {
  delta: number;
  combatantId?: string;
  campaignId?: string;
  resolveRulesPack?: import('./campaignRecordLookup.js').CampaignRulesPackResolver;
}

export interface AdjustExhaustionResult {
  previousLevel: number;
  newLevel: number;
  target: 'character' | 'combatant';
  hpMax?: number;
  hpCurrent?: number;
  died: boolean;
  concentrationBroken?: {
    effectId: string;
    displayName: string;
    cause: 'dead';
  };
}

function readConditions(value: string, label: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) throw new Error('not an array');
    return parsed as Array<{ id: string; [key: string]: unknown }>;
  } catch {
    throw new MutateStateError(`malformed conditions for '${label}'`);
  }
}

export function adjustExhaustion(
  db: Db,
  input: AdjustExhaustionInput,
): AdjustExhaustionResult {
  if (
    !Number.isInteger(input.delta) ||
    input.delta === 0 ||
    input.delta < -6 ||
    input.delta > 6
  )
    throw new MutateStateError(
      'adjust_exhaustion delta must be a non-zero integer from -6 to 6',
    );
  if (input.combatantId !== undefined) {
    if (!input.campaignId)
      throw new MutateStateError('combatant exhaustion requires a campaign');
    return withTransaction(db, (txn) => {
      const current = readCombatant(
        txn,
        input.campaignId as string,
        input.combatantId as string,
      );
      if (current === undefined)
        throw new MutateStateError(`unknown combatant '${input.combatantId}'`);
      const previousLevel = exhaustionLevel(current.conditions);
      const newLevel = Math.max(0, Math.min(6, previousLevel + input.delta));
      const conditions = withExhaustionLevel(current.conditions, newLevel);
      const hpMax = effectiveHpMax(current.hpMax, conditions);
      const update = updateCombatant(txn, {
        campaignId: input.campaignId as string,
        combatantId: input.combatantId as string,
        replaceConditions: conditions,
        clampToEffectiveMaximum: true,
        resolveRulesPack: input.resolveRulesPack,
        ...(newLevel === 6 ? { status: 'dead' as const } : {}),
        provenance: input.provenance,
        sessionId: input.sessionId,
        at: input.at,
      });
      return {
        previousLevel,
        newLevel,
        target: 'combatant',
        hpMax,
        hpCurrent: update.combatant.hpCurrent,
        died: newLevel === 6,
        ...(update.concentrationBroken?.cause === 'dead'
          ? {
              concentrationBroken: {
                effectId: update.concentrationBroken.effectId,
                displayName: update.concentrationBroken.displayName,
                cause: 'dead' as const,
              },
            }
          : {}),
      };
    });
  }
  return withTransaction(db, (txn) => {
    const characterId = resolveCharacterId(txn, input.characterId);
    const row = txn
      .prepare(
        'SELECT conditions_json, hp_current, hp_max FROM character WHERE id=?',
      )
      .get(characterId) as
      | { conditions_json: string; hp_current: number; hp_max: number }
      | undefined;
    if (!row) throw new MutateStateError('no character row exists');
    const conditions = readConditions(row.conditions_json, characterId);
    const previousLevel = exhaustionLevel(conditions as never);
    const newLevel = Math.max(0, Math.min(6, previousLevel + input.delta));
    const nextConditions = withExhaustionLevel(conditions as never, newLevel);
    const transition = applyCharacterExhaustionChanged(
      txn,
      { characterId, conditions: nextConditions },
      input,
    );
    return {
      previousLevel,
      newLevel,
      target: 'character',
      hpMax: transition.hpMax,
      hpCurrent: transition.hpCurrent,
      died: transition.died,
    };
  });
}
