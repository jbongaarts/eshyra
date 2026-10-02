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
import {
  clampCharacterHpToEffectiveMaximum,
  killCharacterFromExhaustion,
} from './hpLifecycle.js';
import { MutateStateError, mutateState } from './mutateState.js';

export interface AdjustExhaustionInput extends DomainMutationContext {
  delta: number;
  combatantId?: string;
  campaignId?: string;
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
    mutateState(txn, {
      target: 'character',
      id: characterId,
      field: 'conditions_json',
      op: 'set',
      value: withExhaustionLevel(conditions as never, newLevel),
      ...input,
    });
    const hpMax = effectiveHpMax(
      row.hp_max,
      withExhaustionLevel(conditions as never, newLevel),
    );
    clampCharacterHpToEffectiveMaximum(txn, {
      ...input,
      characterId,
    });
    const hpCurrent = (
      txn
        .prepare('SELECT hp_current FROM character WHERE id=?')
        .get(characterId) as { hp_current: number }
    ).hp_current;
    const died = newLevel === 6;
    if (died) killCharacterFromExhaustion(txn, { ...input, characterId });
    return {
      previousLevel,
      newLevel,
      target: 'character',
      hpMax,
      hpCurrent,
      died,
    };
  });
}
