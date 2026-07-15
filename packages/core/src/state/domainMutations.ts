import type { Db } from '../persistence/db.js';
import { withTransaction } from '../persistence/db.js';
import { resolveCharacterId } from './activeCharacter.js';
// Function-level circular dependency with activeEffects.ts (which projects
// conditions through addCondition/removeCondition): safe because both sides
// only reference each other inside function bodies. The incapacitation
// reaction lives here so EVERY condition write — the add_condition tool and
// effect projections alike — carries the atomic concentration break.
import {
  anyConditionImpliesIncapacitated,
  breakConcentrationOnLifeEvent,
  conditionImpliesIncapacitated,
} from './activeEffects.js';
import { resolveCampaignAdvancementPolicy } from './advancementPolicy.js';
import type { CharacterConditionEntry } from './liveStateSchema.js';
import {
  MutateStateError,
  type MutateStateInput,
  type MutateStateValue,
  mutateState,
  mutateStateBatch,
} from './mutateState.js';
import {
  getProgressionState,
  ProgressionError,
  type ProgressionEventRecord,
  recordProgressionEvent,
} from './progression.js';

export interface DomainMutationContext {
  provenance: string;
  sessionId: string;
  at: string;
  characterId?: string;
}

export interface AddConditionInput {
  id: string;
  [key: string]: unknown;
}

export interface AddConditionResult {
  added: boolean;
  conditions: readonly CharacterConditionEntry[];
  /** Set when this condition incapacitated a concentrating character: the
   *  F3 break + owned-projection cleanup happened in this transaction. */
  concentrationBroken?: {
    effectId: string;
    displayName: string;
    cause: 'incapacitated';
  };
}

export function addCondition(
  db: Db,
  condition: AddConditionInput,
  ctx: DomainMutationContext,
): AddConditionResult {
  if (typeof condition.id !== 'string' || condition.id.length === 0) {
    throw new MutateStateError('condition id must be a non-empty string');
  }

  return withTransaction(db, (txnDb) => {
    const charId = resolveCharacterId(txnDb, ctx.characterId);
    const current = readConditions(txnDb, charId);

    if (current.some((c) => c.id === condition.id)) {
      return { added: false, conditions: current };
    }

    const entry: CharacterConditionEntry = {
      ...condition,
    } as CharacterConditionEntry;
    const updated = [...current, entry];

    mutateState(txnDb, {
      target: 'character',
      id: charId,
      field: 'conditions_json',
      op: 'set',
      value: updated,
      ...ctx,
    });

    // F3 reaction: a condition whose structured record implies
    // `incapacitated` (or `incapacitated` itself) breaks the character's
    // concentration, atomically with the condition write. Transition-gated:
    // an already-incapacitated character triggers nothing further, and the
    // duplicate-id no-op above never reaches here.
    let concentrationBroken: AddConditionResult['concentrationBroken'];
    if (
      conditionImpliesIncapacitated(txnDb, condition.id) &&
      !anyConditionImpliesIncapacitated(
        txnDb,
        current.map((c) => c.id),
      )
    ) {
      const broken = breakConcentrationOnLifeEvent(
        txnDb,
        charId,
        'incapacitated',
        { provenance: ctx.provenance, sessionId: ctx.sessionId, at: ctx.at },
      );
      if (broken.broken && broken.effectId !== undefined) {
        concentrationBroken = {
          effectId: broken.effectId,
          displayName: broken.displayName ?? broken.effectId,
          cause: 'incapacitated',
        };
      }
    }

    return {
      added: true,
      // The break's cleanup may remove effect-owned conditions from this
      // same character, so re-read rather than returning the stale snapshot.
      conditions:
        concentrationBroken === undefined
          ? updated
          : readConditions(txnDb, charId),
      ...(concentrationBroken === undefined ? {} : { concentrationBroken }),
    };
  });
}

export interface RemoveConditionResult {
  removed: boolean;
  conditions: readonly CharacterConditionEntry[];
}

export function removeCondition(
  db: Db,
  conditionId: string,
  ctx: DomainMutationContext,
): RemoveConditionResult {
  if (typeof conditionId !== 'string' || conditionId.length === 0) {
    throw new MutateStateError('condition id must be a non-empty string');
  }

  return withTransaction(db, (txnDb) => {
    const charId = resolveCharacterId(txnDb, ctx.characterId);
    const current = readConditions(txnDb, charId);
    const updated = current.filter((c) => c.id !== conditionId);

    if (updated.length === current.length) {
      return { removed: false, conditions: current };
    }

    mutateState(txnDb, {
      target: 'character',
      id: charId,
      field: 'conditions_json',
      op: 'set',
      value: updated,
      ...ctx,
    });

    return { removed: true, conditions: updated };
  });
}

export interface GiveItemInput {
  id: string;
  name: string;
  quantity?: number;
  location?: string | null;
  properties?: Record<string, unknown>;
}

export function giveItem(
  db: Db,
  item: GiveItemInput,
  ctx: DomainMutationContext,
): void {
  if (typeof item.id !== 'string' || item.id.length === 0) {
    throw new MutateStateError('item id must be a non-empty string');
  }
  if (typeof item.name !== 'string' || item.name.length === 0) {
    throw new MutateStateError('item name must be a non-empty string');
  }

  withTransaction(db, (txnDb) => {
    const charId = resolveCharacterId(txnDb, ctx.characterId);

    const base = {
      target: 'inventory' as const,
      id: item.id,
      op: 'set' as const,
      ...ctx,
    };

    const mutations: MutateStateInput[] = [
      { ...base, field: 'name', value: item.name },
      { ...base, field: 'quantity', value: item.quantity ?? 1 },
    ];

    if (item.location !== undefined) {
      mutations.push({ ...base, field: 'location', value: item.location });
    }

    if (item.properties !== undefined) {
      mutations.push({
        ...base,
        field: 'properties_json',
        value: item.properties,
      });
    }

    mutateStateBatch(txnDb, mutations);

    txnDb
      .prepare('UPDATE inventory SET character_id = ? WHERE id = ?')
      .run(charId, item.id);
  });
}

export interface RemoveItemResult {
  removed: boolean;
  previousQuantity: number;
  newQuantity: number;
}

export function removeItem(
  db: Db,
  itemId: string,
  quantity: number | undefined,
  ctx: DomainMutationContext,
): RemoveItemResult {
  if (typeof itemId !== 'string' || itemId.length === 0) {
    throw new MutateStateError('item id must be a non-empty string');
  }
  if (quantity !== undefined && (!Number.isInteger(quantity) || quantity < 1)) {
    throw new MutateStateError(
      'remove_item quantity must be a positive integer',
    );
  }

  return withTransaction(db, (txnDb) => {
    const charId = resolveCharacterId(txnDb, ctx.characterId);
    const row = txnDb
      .prepare(
        'SELECT quantity FROM inventory WHERE id = ? AND (character_id = ? OR character_id IS NULL)',
      )
      .get(itemId, charId) as { quantity: number } | undefined;

    if (row === undefined) {
      return { removed: false, previousQuantity: 0, newQuantity: 0 };
    }

    const previousQuantity = row.quantity;

    if (quantity === undefined || previousQuantity - quantity <= 0) {
      txnDb
        .prepare(
          'DELETE FROM inventory WHERE id = ? AND (character_id = ? OR character_id IS NULL)',
        )
        .run(itemId, charId);
      return { removed: true, previousQuantity, newQuantity: 0 };
    }

    const newQuantity = previousQuantity - quantity;
    mutateState(txnDb, {
      target: 'inventory',
      id: itemId,
      field: 'quantity',
      op: 'set',
      value: newQuantity,
      ...ctx,
    });

    return { removed: false, previousQuantity, newQuantity };
  });
}

export interface UpdateClockInput {
  inGameTime?: string;
  locationId?: string | null;
}

export function updateClock(
  db: Db,
  input: UpdateClockInput,
  ctx: DomainMutationContext,
): void {
  const base = {
    target: 'clock' as const,
    op: 'set' as const,
    ...ctx,
  };

  const mutations = [];

  if (input.inGameTime !== undefined) {
    mutations.push({ ...base, field: 'in_game_time', value: input.inGameTime });
    const elapsed = db
      .prepare('SELECT elapsed_minutes FROM clock WHERE id=1')
      .get() as { elapsed_minutes: number } | undefined;
    if (elapsed === undefined)
      throw new MutateStateError('campaign clock is missing');
    mutations.push({
      ...base,
      field: 'in_game_time_elapsed_minutes',
      value: elapsed.elapsed_minutes,
    });
  }
  if (input.locationId !== undefined) {
    mutations.push({
      ...base,
      field: 'current_location_id',
      value: input.locationId as MutateStateValue,
    });
  }

  if (mutations.length === 0) {
    throw new MutateStateError(
      'update_clock requires at least one of in_game_time or location_id',
    );
  }

  mutateStateBatch(db, mutations);
}

export function setPlotFlag(
  db: Db,
  key: string,
  value: MutateStateValue,
  ctx: DomainMutationContext,
): void {
  mutateState(db, {
    target: 'plot_flags',
    field: key,
    op: 'set',
    value,
    ...ctx,
  });
}

export function setWorldFact(
  db: Db,
  key: string,
  value: MutateStateValue,
  ctx: DomainMutationContext,
): void {
  mutateState(db, {
    target: 'overlay_facts',
    field: key,
    op: 'set',
    value,
    ...ctx,
  });
}

// ---------------------------------------------------------------------------
// Progression awards (eshyra-lupf.6)
// ---------------------------------------------------------------------------
//
// Higher-level, policy-aware wrappers that record an advancement award as one
// atomic, auditable mutation: they update durable state (XP) and append the
// matching `progression_event` ledger row in a single transaction, consulting
// the campaign advancement policy so the two modes can't be mixed.
//
// Awards never change the character's *level*: crossing a threshold only makes
// the character eligible (eshyra-lupf.7), and applying the level-up is a
// separate deterministic step (eshyra-lupf.8). So every award row records the
// current level as its `resultingLevel`.

/** Result of an {@link awardXp} mutation. */
export interface AwardXpResult {
  readonly previousXp: number;
  readonly newXp: number;
  /** Character level after the award — unchanged; awards never level up. */
  readonly level: number;
  readonly event: ProgressionEventRecord;
}

/** Result of a {@link grantMilestone} mutation. */
export interface GrantMilestoneResult {
  /** Character level after the grant — unchanged; grants never level up. */
  readonly level: number;
  readonly event: ProgressionEventRecord;
}

/**
 * Award experience points to a character. Valid only in XP mode: the campaign
 * advancement policy is consulted and this **fails closed** under a
 * milestone-mode (or otherwise non-XP) policy rather than silently writing an
 * XP total that mode never consults.
 *
 * The new XP total is written through the validated `current_xp` mutateState
 * seam and an `xp-award` ledger row is appended in the same transaction, so the
 * persisted total and its audit row can never diverge.
 *
 * @param amount  XP to add; must be a positive integer.
 * @param source  Who/what caused the award (encounter, quest, DM ruling, …).
 * @throws {MutateStateError} if `amount` is not a positive integer.
 * @throws {ProgressionError} if the campaign is not in XP mode.
 */
export function awardXp(
  db: Db,
  amount: number,
  source: string,
  ctx: DomainMutationContext,
): AwardXpResult {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new MutateStateError('award_xp amount must be a positive integer');
  }

  return withTransaction(db, (txnDb) => {
    const policy = resolveCampaignAdvancementPolicy(txnDb);
    if (policy.mode !== 'xp') {
      throw new ProgressionError(
        `cannot award XP under '${policy.mode}' advancement mode; ` +
          'use grantMilestone for milestone-mode campaigns',
      );
    }

    const charId = resolveCharacterId(txnDb, ctx.characterId);
    const before = getProgressionState(txnDb, charId);
    const newXp = before.currentXp + amount;

    mutateState(txnDb, {
      target: 'character',
      id: charId,
      field: 'current_xp',
      op: 'set',
      value: newXp,
      ...ctx,
    });

    const event = recordProgressionEvent(txnDb, {
      characterId: charId,
      kind: 'xp-award',
      amount,
      source,
      resultingXp: newXp,
      resultingLevel: before.level,
      occurredAt: ctx.at,
      provenance: ctx.provenance,
      sessionId: ctx.sessionId,
    });

    return {
      previousXp: before.currentXp,
      newXp,
      level: before.level,
      event,
    };
  });
}

/**
 * Grant a milestone to a character. Valid only in milestone mode: the campaign
 * advancement policy is consulted and this **fails closed** under an XP-mode
 * policy rather than recording a milestone the campaign never consults.
 *
 * A milestone has no XP total; the grant is recorded purely as an append-only
 * `milestone-award` ledger row (the ledger is the milestone's durable state).
 * Eligibility from an outstanding milestone is computed downstream
 * (eshyra-lupf.7).
 *
 * @param milestoneLabel  Human-readable description of the milestone.
 * @param source          Who/what granted it (DM ruling, quest, …).
 * @throws {MutateStateError} if `milestoneLabel` is empty.
 * @throws {ProgressionError} if the campaign is not in milestone mode.
 */
export function grantMilestone(
  db: Db,
  milestoneLabel: string,
  source: string,
  ctx: DomainMutationContext,
): GrantMilestoneResult {
  if (
    typeof milestoneLabel !== 'string' ||
    milestoneLabel.trim().length === 0
  ) {
    throw new MutateStateError('milestone label must be a non-empty string');
  }

  return withTransaction(db, (txnDb) => {
    const policy = resolveCampaignAdvancementPolicy(txnDb);
    if (policy.mode !== 'milestone') {
      throw new ProgressionError(
        `cannot grant a milestone under '${policy.mode}' advancement mode; ` +
          'use awardXp for XP-mode campaigns',
      );
    }

    const charId = resolveCharacterId(txnDb, ctx.characterId);
    const before = getProgressionState(txnDb, charId);

    const event = recordProgressionEvent(txnDb, {
      characterId: charId,
      kind: 'milestone-award',
      milestoneLabel,
      source,
      resultingLevel: before.level,
      occurredAt: ctx.at,
      provenance: ctx.provenance,
      sessionId: ctx.sessionId,
    });

    return { level: before.level, event };
  });
}

function readConditions(
  db: Db,
  characterId: string,
): CharacterConditionEntry[] {
  const row = db
    .prepare('SELECT conditions_json FROM character WHERE id = ?')
    .get(characterId) as { conditions_json: string } | undefined;

  if (row === undefined) {
    throw new MutateStateError('no character row exists');
  }

  return JSON.parse(row.conditions_json) as CharacterConditionEntry[];
}
