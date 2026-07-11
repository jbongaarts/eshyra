// Action-economy turn budget for structured combat (eshyra-2n1t.4, engine
// family F2; source: docs/audits/dnd5e-srd-5.1-final/
// 2026-07-06-o9bd-18-7-8-execution-boundary-classification.md §4).
//
// SRD 5.1 semantics, code-owned so the model can never silently violate them:
//
// - One action, one bonus action, and one free object interaction per turn
//   (your-turn, bonus-actions, other-activity-on-your-turn). A second object
//   interaction requires the action (Use an Object), which the model records
//   as an ordinary action spend.
// - One reaction per round, regained at the start of the participant's own
//   turn — the one budget that crosses turn boundaries (reactions).
// - Casting a spell as a bonus action restricts every other spell cast that
//   turn to a cantrip with a casting time of 1 action, in either order
//   (bonus-action). The caller declares cantrip-ness (`spell.cantrip`); the
//   casting time is implied by which resource the cast spends.
// - A surprised participant can take no move, action, or bonus action on its
//   first turn and no reaction until that turn ends (surprise). Surprise
//   determination (Stealth vs passive Perception) stays a DM ruling; this
//   module owns recording and enforcing the restriction.
// - Two-weapon fighting's extra attack is an ordinary bonus-action spend;
//   its damage composition is F9's, its weapon eligibility a ruling
//   (two-weapon-fighting).
//
// Deliberately NOT a legality engine (classification §4, family F2):
// movement is a narrative note, not a numeric budget; attack counting
// (Extra Attack, Multiattack) and action choice stay model-adjudicated; and
// condition-based incapacity (can a dying/stunned creature act?) belongs to
// the condition lifecycle (F3), not the budget — only death is hard-gated
// here because life/death state has been code-owned since F6.
//
// A "participant" is either a party character (`character`, ref = character
// id) or a live encounter combatant (`combatant`, ref = combatant id) — the
// same id split the HP write path (characters) and update_combatant
// (combatants) already use. Each participant has exactly one
// `combat_turn_budget` row per combat instance, reset in place by
// {@link beginTurn}; rounds and turn order are model-narrated (initiative is
// a ruling), so the round counter only enforces monotonicity.

import type { Db } from '../persistence/db.js';
import { withTransaction } from '../persistence/db.js';
import { resolveCharacterId } from './activeCharacter.js';
import {
  getActiveCombatInstance,
  listCombatantsForInstance,
} from './encounterCombatants.js';
import type { LifeState } from './hpLifecycle.js';

export type TurnParticipantKind = 'character' | 'combatant';

export interface TurnParticipant {
  readonly kind: TurnParticipantKind;
  readonly ref: string;
}

/**
 * Participant selector as tools pass it: a combatant needs its exact id,
 * while a character ref is optional and defaults to the acting character.
 */
export interface TurnParticipantInput {
  readonly kind: TurnParticipantKind;
  readonly ref?: string;
}

export type TurnResource =
  | 'action'
  | 'bonus_action'
  | 'reaction'
  | 'free_interaction'
  | 'movement';

export type OtherSpellCast = 'none' | 'action-cantrip' | 'other';

export interface TurnBudget {
  readonly participant: TurnParticipant;
  readonly displayLabel: string;
  readonly surprised: boolean;
  readonly turnsTaken: number;
  readonly actionUsed: boolean;
  readonly actionActivity: string | undefined;
  readonly bonusActionUsed: boolean;
  readonly bonusActionActivity: string | undefined;
  readonly reactionUsed: boolean;
  readonly reactionActivity: string | undefined;
  readonly freeInteractionUsed: boolean;
  readonly freeInteractionActivity: string | undefined;
  readonly movementNote: string | undefined;
  readonly bonusActionSpellCast: boolean;
  readonly otherSpellCast: OtherSpellCast;
}

export interface CombatTurnState {
  readonly combatInstanceId: string;
  readonly roundNumber: number;
  readonly activeParticipant: TurnParticipant | undefined;
  readonly budgets: readonly TurnBudget[];
}

export interface TurnMutationContext {
  readonly provenance: string;
  readonly sessionId: string;
  readonly at: string;
}

export interface BeginTurnInput extends TurnMutationContext {
  readonly campaignId: string;
  readonly participant: TurnParticipantInput;
  /** Explicit combat round; must not decrease. Omitted keeps the current
   *  round (the first begin_turn of an instance opens round 1). */
  readonly round?: number;
}

export interface BeginTurnResult {
  readonly combatInstanceId: string;
  readonly roundNumber: number;
  readonly budget: TurnBudget;
  /** True when the participant is surprised: every spend on this turn will
   *  be refused, and its reaction returns only when this turn ends. */
  readonly surprisedRestricted: boolean;
}

export interface SpendTurnResourceInput extends TurnMutationContext {
  readonly campaignId: string;
  readonly participant: TurnParticipantInput;
  readonly resource: TurnResource;
  /** What the spend was, e.g. "Attack (shortsword)" or "moved 20 ft to the
   *  altar". Movement spends append to the turn's movement note. */
  readonly activity: string;
  /** Present iff this spend casts a spell; carries the one fact the timing
   *  invariant needs. Casting time is implied by the resource spent. */
  readonly spell?: { readonly cantrip: boolean };
}

export interface SpendTurnResourceResult {
  readonly combatInstanceId: string;
  readonly roundNumber: number;
  readonly resource: TurnResource;
  readonly activity: string;
  readonly budget: TurnBudget;
}

export interface SetSurprisedInput extends TurnMutationContext {
  readonly campaignId: string;
  readonly participants: readonly TurnParticipantInput[];
}

export interface SetSurprisedResult {
  readonly combatInstanceId: string;
  readonly surprised: readonly TurnParticipant[];
}

export class ActionEconomyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ActionEconomyError';
  }
}

interface BudgetRow {
  readonly participant_kind: TurnParticipantKind;
  readonly participant_ref: string;
  readonly surprised: number;
  readonly turns_taken: number;
  readonly action_used: number;
  readonly action_activity: string | null;
  readonly bonus_action_used: number;
  readonly bonus_action_activity: string | null;
  readonly reaction_used: number;
  readonly reaction_activity: string | null;
  readonly free_interaction_used: number;
  readonly free_interaction_activity: string | null;
  readonly movement_note: string | null;
  readonly bonus_action_spell_cast: number;
  readonly other_spell_cast: OtherSpellCast;
}

const BUDGET_COLUMNS = `participant_kind, participant_ref, surprised,
       turns_taken, action_used, action_activity, bonus_action_used,
       bonus_action_activity, reaction_used, reaction_activity,
       free_interaction_used, free_interaction_activity, movement_note,
       bonus_action_spell_cast, other_spell_cast`;

function rowToBudget(row: BudgetRow, displayLabel: string): TurnBudget {
  return {
    participant: { kind: row.participant_kind, ref: row.participant_ref },
    displayLabel,
    surprised: row.surprised === 1,
    turnsTaken: row.turns_taken,
    actionUsed: row.action_used === 1,
    actionActivity: row.action_activity ?? undefined,
    bonusActionUsed: row.bonus_action_used === 1,
    bonusActionActivity: row.bonus_action_activity ?? undefined,
    reactionUsed: row.reaction_used === 1,
    reactionActivity: row.reaction_activity ?? undefined,
    freeInteractionUsed: row.free_interaction_used === 1,
    freeInteractionActivity: row.free_interaction_activity ?? undefined,
    movementNote: row.movement_note ?? undefined,
    bonusActionSpellCast: row.bonus_action_spell_cast === 1,
    otherSpellCast: row.other_spell_cast,
  };
}

/**
 * Resolve and validate a participant against the active combat instance:
 * a combatant must be a live member of that instance; a character ref (or
 * its acting-character default) must resolve, and the dead take no turns.
 * Returns the concrete participant plus a display label for results.
 */
function resolveParticipant(
  db: Db,
  campaignId: string,
  combatInstanceId: string,
  input: TurnParticipantInput,
): { participant: TurnParticipant; displayLabel: string } {
  if (input.kind === 'combatant') {
    if (input.ref === undefined || input.ref.length === 0) {
      throw new ActionEconomyError('a combatant participant needs its ref');
    }
    const combatant = db
      .prepare(
        `SELECT combat_instance_id, display_label, status
         FROM encounter_combatant
         WHERE campaign_id = ? AND combatant_id = ?`,
      )
      .get(campaignId, input.ref) as
      | { combat_instance_id: string; display_label: string; status: string }
      | undefined;
    if (
      combatant === undefined ||
      combatant.combat_instance_id !== combatInstanceId
    ) {
      const ids = listCombatantsForInstance(db, campaignId, combatInstanceId)
        .map((c) => c.combatantId)
        .join(', ');
      throw new ActionEconomyError(
        `unknown combatant '${input.ref}' in active combat instance ` +
          `'${combatInstanceId}'. Valid combatant ids: ${ids || '(none)'}.`,
      );
    }
    if (combatant.status === 'dead') {
      throw new ActionEconomyError(
        `combatant '${input.ref}' is dead and has no place in the turn order`,
      );
    }
    if (combatant.status === 'escaped' || combatant.status === 'inactive') {
      throw new ActionEconomyError(
        `combatant '${input.ref}' is ${combatant.status} and no longer participates in combat`,
      );
    }
    return {
      participant: { kind: 'combatant', ref: input.ref },
      displayLabel: combatant.display_label,
    };
  }

  const charId = resolveCharacterId(db, input.ref);
  const character = db
    .prepare('SELECT name, life_state FROM character WHERE id = ?')
    .get(charId) as { name: string | null; life_state: LifeState } | undefined;
  if (character === undefined) {
    throw new ActionEconomyError(`no character row exists for '${charId}'`);
  }
  if (character.life_state === 'dead') {
    throw new ActionEconomyError(
      `character '${character.name ?? charId}' is dead and has no turn`,
    );
  }
  return {
    participant: { kind: 'character', ref: charId },
    displayLabel: character.name ?? charId,
  };
}

function requireActiveInstance(db: Db, campaignId: string) {
  const instance = getActiveCombatInstance(db, campaignId);
  if (instance === undefined) {
    throw new ActionEconomyError(
      'no combat instance is active; the turn budget applies only to structured combat (start_encounter first)',
    );
  }
  return instance;
}

function readInstanceTurnFields(
  db: Db,
  campaignId: string,
  instanceId: string,
) {
  return db
    .prepare(
      `SELECT round_number, active_participant_kind, active_participant_ref
       FROM combat_instance
       WHERE campaign_id = ? AND combat_instance_id = ?`,
    )
    .get(campaignId, instanceId) as {
    round_number: number;
    active_participant_kind: TurnParticipantKind | null;
    active_participant_ref: string | null;
  };
}

function readBudgetRow(
  db: Db,
  campaignId: string,
  instanceId: string,
  participant: TurnParticipant,
): BudgetRow | undefined {
  return db
    .prepare(
      `SELECT ${BUDGET_COLUMNS}
       FROM combat_turn_budget
       WHERE campaign_id = ? AND combat_instance_id = ?
         AND participant_kind = ? AND participant_ref = ?`,
    )
    .get(campaignId, instanceId, participant.kind, participant.ref) as
    | BudgetRow
    | undefined;
}

/** Insert the participant's budget row if it does not exist yet. */
function ensureBudgetRow(
  db: Db,
  campaignId: string,
  instanceId: string,
  participant: TurnParticipant,
  ctx: TurnMutationContext,
): void {
  db.prepare(
    `INSERT INTO combat_turn_budget(
       campaign_id, combat_instance_id, participant_kind, participant_ref,
       provenance, session_id, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(campaign_id, combat_instance_id, participant_kind,
                 participant_ref) DO NOTHING`,
  ).run(
    campaignId,
    instanceId,
    participant.kind,
    participant.ref,
    ctx.provenance,
    ctx.sessionId,
    ctx.at,
  );
}

export function beginTurn(db: Db, input: BeginTurnInput): BeginTurnResult {
  return withTransaction(db, (txnDb) => {
    const instance = requireActiveInstance(txnDb, input.campaignId);
    const { participant, displayLabel } = resolveParticipant(
      txnDb,
      input.campaignId,
      instance.combatInstanceId,
      input.participant,
    );

    const turn = readInstanceTurnFields(
      txnDb,
      input.campaignId,
      instance.combatInstanceId,
    );

    let round = Math.max(1, turn.round_number);
    if (input.round !== undefined) {
      if (!Number.isInteger(input.round) || input.round < 1) {
        throw new ActionEconomyError('round must be a positive integer');
      }
      if (input.round < round && turn.round_number > 0) {
        throw new ActionEconomyError(
          `round must not decrease (current round is ${round})`,
        );
      }
      round = input.round;
    }

    // Ending the previous participant's turn is implicit in beginning the
    // next: it has now taken a turn, and — surprise lasting only until the
    // end of the first turn — its surprised flag clears.
    if (
      turn.active_participant_kind !== null &&
      turn.active_participant_ref !== null
    ) {
      txnDb
        .prepare(
          `UPDATE combat_turn_budget
           SET turns_taken = turns_taken + 1, surprised = 0,
               provenance = ?, session_id = ?, updated_at = ?
           WHERE campaign_id = ? AND combat_instance_id = ?
             AND participant_kind = ? AND participant_ref = ?`,
        )
        .run(
          input.provenance,
          input.sessionId,
          input.at,
          input.campaignId,
          instance.combatInstanceId,
          turn.active_participant_kind,
          turn.active_participant_ref,
        );
    }

    // Reset the new participant's per-turn budget in place. The reaction
    // returns at the start of its own turn; surprised and turns_taken are
    // the two fields that survive the reset.
    ensureBudgetRow(
      txnDb,
      input.campaignId,
      instance.combatInstanceId,
      participant,
      input,
    );
    txnDb
      .prepare(
        `UPDATE combat_turn_budget
         SET action_used = 0, action_activity = NULL,
             bonus_action_used = 0, bonus_action_activity = NULL,
             reaction_used = 0, reaction_activity = NULL,
             free_interaction_used = 0, free_interaction_activity = NULL,
             movement_note = NULL, bonus_action_spell_cast = 0,
             other_spell_cast = 'none',
             provenance = ?, session_id = ?, updated_at = ?
         WHERE campaign_id = ? AND combat_instance_id = ?
           AND participant_kind = ? AND participant_ref = ?`,
      )
      .run(
        input.provenance,
        input.sessionId,
        input.at,
        input.campaignId,
        instance.combatInstanceId,
        participant.kind,
        participant.ref,
      );

    txnDb
      .prepare(
        `UPDATE combat_instance
         SET round_number = ?, active_participant_kind = ?,
             active_participant_ref = ?, provenance = ?, session_id = ?,
             updated_at = ?
         WHERE campaign_id = ? AND combat_instance_id = ?`,
      )
      .run(
        round,
        participant.kind,
        participant.ref,
        input.provenance,
        input.sessionId,
        input.at,
        input.campaignId,
        instance.combatInstanceId,
      );

    const row = readBudgetRow(
      txnDb,
      input.campaignId,
      instance.combatInstanceId,
      participant,
    );
    if (row === undefined) {
      throw new ActionEconomyError('turn budget row disappeared during reset');
    }
    return {
      combatInstanceId: instance.combatInstanceId,
      roundNumber: round,
      budget: rowToBudget(row, displayLabel),
      surprisedRestricted: row.surprised === 1,
    };
  });
}

function escalateOtherSpellCast(
  current: OtherSpellCast,
  cast: 'action-cantrip' | 'other',
): OtherSpellCast {
  return current === 'other' ? 'other' : cast;
}

export function spendTurnResource(
  db: Db,
  input: SpendTurnResourceInput,
): SpendTurnResourceResult {
  if (input.activity.trim().length === 0) {
    throw new ActionEconomyError('activity must be a non-empty description');
  }
  if (
    input.spell !== undefined &&
    (input.resource === 'movement' || input.resource === 'free_interaction')
  ) {
    throw new ActionEconomyError(
      'a spell cast spends an action, bonus action, or reaction — not movement or the free interaction',
    );
  }

  return withTransaction(db, (txnDb) => {
    const instance = requireActiveInstance(txnDb, input.campaignId);
    const { participant, displayLabel } = resolveParticipant(
      txnDb,
      input.campaignId,
      instance.combatInstanceId,
      input.participant,
    );
    const turn = readInstanceTurnFields(
      txnDb,
      input.campaignId,
      instance.combatInstanceId,
    );

    const isOwnTurn =
      turn.active_participant_kind === participant.kind &&
      turn.active_participant_ref === participant.ref;
    if (input.resource !== 'reaction' && !isOwnTurn) {
      throw new ActionEconomyError(
        `it is not ${displayLabel}'s turn; only a reaction can be spent off-turn (call begin_turn when their turn starts)`,
      );
    }

    ensureBudgetRow(
      txnDb,
      input.campaignId,
      instance.combatInstanceId,
      participant,
      input,
    );
    const row = readBudgetRow(
      txnDb,
      input.campaignId,
      instance.combatInstanceId,
      participant,
    );
    if (row === undefined) {
      throw new ActionEconomyError('turn budget row disappeared during spend');
    }

    if (row.surprised === 1) {
      throw new ActionEconomyError(
        `${displayLabel} is surprised: no move, action, or bonus action on ` +
          'their first turn, and no reaction until that turn ends',
      );
    }

    const updates: Record<string, string | number> = {};
    switch (input.resource) {
      case 'action': {
        if (row.action_used === 1) {
          throw new ActionEconomyError(
            `${displayLabel} has already used their action this turn` +
              (row.action_activity === null ? '' : ` (${row.action_activity})`),
          );
        }
        if (input.spell !== undefined) {
          if (row.bonus_action_spell_cast === 1 && !input.spell.cantrip) {
            throw new ActionEconomyError(
              `${displayLabel} cast a spell as a bonus action this turn: the only other spell allowed is a cantrip with a casting time of 1 action`,
            );
          }
          updates.other_spell_cast = escalateOtherSpellCast(
            row.other_spell_cast,
            input.spell.cantrip ? 'action-cantrip' : 'other',
          );
        }
        updates.action_used = 1;
        updates.action_activity = input.activity;
        break;
      }
      case 'bonus_action': {
        if (row.bonus_action_used === 1) {
          throw new ActionEconomyError(
            `${displayLabel} has already used their bonus action this turn` +
              (row.bonus_action_activity === null
                ? ''
                : ` (${row.bonus_action_activity})`),
          );
        }
        if (input.spell !== undefined) {
          if (row.other_spell_cast === 'other') {
            throw new ActionEconomyError(
              `${displayLabel} already cast a spell other than an action cantrip this turn, so no bonus-action spell is allowed`,
            );
          }
          updates.bonus_action_spell_cast = 1;
        }
        updates.bonus_action_used = 1;
        updates.bonus_action_activity = input.activity;
        break;
      }
      case 'reaction': {
        if (row.reaction_used === 1) {
          throw new ActionEconomyError(
            `${displayLabel} has already used their reaction this round` +
              (row.reaction_activity === null
                ? ''
                : ` (${row.reaction_activity})`) +
              '; it returns at the start of their next turn',
          );
        }
        if (input.spell !== undefined && isOwnTurn) {
          // A reaction spell on the caster's own turn is never a cantrip
          // with a casting time of 1 action, so it participates in the
          // bonus-action-spell restriction both ways.
          if (row.bonus_action_spell_cast === 1) {
            throw new ActionEconomyError(
              `${displayLabel} cast a spell as a bonus action this turn: the only other spell allowed is a cantrip with a casting time of 1 action`,
            );
          }
          updates.other_spell_cast = escalateOtherSpellCast(
            row.other_spell_cast,
            'other',
          );
        }
        updates.reaction_used = 1;
        updates.reaction_activity = input.activity;
        break;
      }
      case 'free_interaction': {
        if (row.free_interaction_used === 1) {
          throw new ActionEconomyError(
            `${displayLabel} has already used their free object interaction this turn` +
              (row.free_interaction_activity === null
                ? ''
                : ` (${row.free_interaction_activity})`) +
              '; a second object interaction takes the action (Use an Object)',
          );
        }
        updates.free_interaction_used = 1;
        updates.free_interaction_activity = input.activity;
        break;
      }
      case 'movement': {
        // Deliberately not a numeric budget (classification §4): the note
        // accumulates so the turn's movement stays visible in context.
        updates.movement_note =
          row.movement_note === null
            ? input.activity
            : `${row.movement_note}; ${input.activity}`;
        break;
      }
    }

    const setClause = Object.keys(updates)
      .map((column) => `${column} = ?`)
      .join(', ');
    txnDb
      .prepare(
        `UPDATE combat_turn_budget
         SET ${setClause}, provenance = ?, session_id = ?, updated_at = ?
         WHERE campaign_id = ? AND combat_instance_id = ?
           AND participant_kind = ? AND participant_ref = ?`,
      )
      .run(
        ...Object.values(updates),
        input.provenance,
        input.sessionId,
        input.at,
        input.campaignId,
        instance.combatInstanceId,
        participant.kind,
        participant.ref,
      );

    const after = readBudgetRow(
      txnDb,
      input.campaignId,
      instance.combatInstanceId,
      participant,
    );
    if (after === undefined) {
      throw new ActionEconomyError('turn budget row disappeared during spend');
    }
    return {
      combatInstanceId: instance.combatInstanceId,
      roundNumber: turn.round_number,
      resource: input.resource,
      activity: input.activity,
      budget: rowToBudget(after, displayLabel),
    };
  });
}

/**
 * Record which participants are surprised, after the DM adjudicates the
 * Stealth-vs-passive-Perception determination. Surprise applies only to the
 * first turn of combat, so a participant that has already taken a turn is
 * rejected; {@link beginTurn} clears the flag when the surprised turn ends.
 */
export function setSurprised(
  db: Db,
  input: SetSurprisedInput,
): SetSurprisedResult {
  if (input.participants.length === 0) {
    throw new ActionEconomyError(
      'set_surprised needs at least one participant',
    );
  }

  return withTransaction(db, (txnDb) => {
    const instance = requireActiveInstance(txnDb, input.campaignId);
    const surprised: TurnParticipant[] = [];

    for (const participantInput of input.participants) {
      const { participant, displayLabel } = resolveParticipant(
        txnDb,
        input.campaignId,
        instance.combatInstanceId,
        participantInput,
      );
      ensureBudgetRow(
        txnDb,
        input.campaignId,
        instance.combatInstanceId,
        participant,
        input,
      );
      const row = readBudgetRow(
        txnDb,
        input.campaignId,
        instance.combatInstanceId,
        participant,
      );
      if (row !== undefined && row.turns_taken > 0) {
        throw new ActionEconomyError(
          `${displayLabel} has already taken a turn this combat; surprise applies only to the first turn`,
        );
      }
      txnDb
        .prepare(
          `UPDATE combat_turn_budget
           SET surprised = 1, provenance = ?, session_id = ?, updated_at = ?
           WHERE campaign_id = ? AND combat_instance_id = ?
             AND participant_kind = ? AND participant_ref = ?`,
        )
        .run(
          input.provenance,
          input.sessionId,
          input.at,
          input.campaignId,
          instance.combatInstanceId,
          participant.kind,
          participant.ref,
        );
      surprised.push(participant);
    }

    return { combatInstanceId: instance.combatInstanceId, surprised };
  });
}

/**
 * The active combat instance's structured turn state for the context
 * snapshot: round, whose turn it is, and every participant budget recorded
 * so far. `undefined` when no combat is active; a `roundNumber` of 0 means
 * combat started but no structured turn has been opened yet.
 */
export function readCombatTurnState(
  db: Db,
  campaignId: string,
): CombatTurnState | undefined {
  const instance = getActiveCombatInstance(db, campaignId);
  if (instance === undefined) {
    return undefined;
  }
  const turn = readInstanceTurnFields(
    db,
    campaignId,
    instance.combatInstanceId,
  );
  const rows = db
    .prepare(
      `SELECT ${BUDGET_COLUMNS}
       FROM combat_turn_budget
       WHERE campaign_id = ? AND combat_instance_id = ?
       ORDER BY participant_kind, participant_ref`,
    )
    .all(campaignId, instance.combatInstanceId) as BudgetRow[];

  const combatantLabels = new Map(
    listCombatantsForInstance(db, campaignId, instance.combatInstanceId).map(
      (combatant) => [combatant.combatantId, combatant.displayLabel],
    ),
  );
  const budgets = rows.map((row) => {
    const label =
      row.participant_kind === 'combatant'
        ? (combatantLabels.get(row.participant_ref) ?? row.participant_ref)
        : ((
            db
              .prepare('SELECT name FROM character WHERE id = ?')
              .get(row.participant_ref) as { name: string | null } | undefined
          )?.name ?? row.participant_ref);
    return rowToBudget(row, label);
  });

  return {
    combatInstanceId: instance.combatInstanceId,
    roundNumber: turn.round_number,
    activeParticipant:
      turn.active_participant_kind === null ||
      turn.active_participant_ref === null
        ? undefined
        : {
            kind: turn.active_participant_kind,
            ref: turn.active_participant_ref,
          },
    budgets,
  };
}

/**
 * Render one participant's budget as the compact fragment the context
 * snapshot shows the model, e.g.
 * `action used (Attack), bonus action available, reaction available, free interaction available`.
 */
export function formatTurnBudget(budget: TurnBudget): string {
  const slot = (used: boolean, label: string, activity: string | undefined) =>
    used
      ? `${label} used${activity ? ` (${activity})` : ''}`
      : `${label} available`;
  const parts = [
    slot(budget.actionUsed, 'action', budget.actionActivity),
    slot(budget.bonusActionUsed, 'bonus action', budget.bonusActionActivity),
    slot(budget.reactionUsed, 'reaction', budget.reactionActivity),
    slot(
      budget.freeInteractionUsed,
      'free interaction',
      budget.freeInteractionActivity,
    ),
  ];
  if (budget.movementNote !== undefined) {
    parts.push(`movement: ${budget.movementNote}`);
  }
  if (budget.bonusActionSpellCast) {
    parts.push('bonus-action spell cast (other spells: action cantrips only)');
  }
  return parts.join(', ');
}
