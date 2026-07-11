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
// - The reaction is an allowance, not a boolean: normally 1 per round,
//   regained at the start of the participant's own turn — the one budget
//   that crosses turn boundaries (reactions). Typed `extraReactions` pack
//   mechanics raise it: a `perTurn` grant (marilith Reactive) refreshes the
//   count at the start of EVERY turn; a `formula` grant (hydra Reactive
//   Heads, one per head beyond one) depends on live state the engine does
//   not track, so the DM records the current total through the validated
//   {@link setReactionAllowance} grant — accepted only for creatures whose
//   record structurally carries such a mechanic. A `restrictedTo` clause
//   (hydra: opportunity attacks only) is surfaced on extra spends; whether
//   a given activity satisfies it stays a ruling.
// - Casting a spell as a bonus action restricts every other spell cast that
//   turn to a cantrip with a casting time of 1 action, in either order
//   (bonus-action). The caller passes the spell's pack ref (`spellRef`);
//   the engine resolves it against the campaign rules stack and derives
//   cantrip status and casting time from the record — never from a
//   model-declared flag. A spend whose activity reads like a spell cast
//   without a spellRef fails closed.
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
import {
  DEFAULT_DND5E_SRD_BINDING,
  readCampaignRulesBinding,
} from '../rules/binding.js';
import { getBundledDnd5eSrdPack } from '../rules/bundledSrdPack.js';
import { lookupRulesRecord } from '../rules/lookup.js';
import { PATHFINDER2E_REMASTER_RULES_PACK } from '../rules/pathfinder2eRemaster.js';
import { resolveRulesStack } from '../rules/stack.js';
import type { RulesRecord, RulesRecordKind } from '../rules/types.js';
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

/** When a participant's spent reactions reset: at the start of their own
 *  turn (the SRD default) or at the start of every turn (perTurn
 *  extraReactions mechanics, e.g. the marilith's Reactive). */
export type ReactionRefresh = 'own_turn' | 'every_turn';

export interface TurnBudget {
  readonly participant: TurnParticipant;
  readonly displayLabel: string;
  readonly surprised: boolean;
  readonly turnsTaken: number;
  readonly actionUsed: boolean;
  readonly actionActivity: string | undefined;
  readonly bonusActionUsed: boolean;
  readonly bonusActionActivity: string | undefined;
  readonly reactionsUsed: number;
  readonly reactionAllowance: number;
  readonly reactionRefresh: ReactionRefresh;
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
  /** Present iff this spend casts a spell: the spell's pack ref (e.g.
   *  "spell:healing-word"). The engine resolves it against the campaign
   *  rules stack and derives cantrip status/casting time from the record;
   *  an unresolvable ref fails closed. */
  readonly spellRef?: string;
}

export interface SpendTurnResourceResult {
  readonly combatInstanceId: string;
  readonly roundNumber: number;
  readonly resource: TurnResource;
  readonly activity: string;
  readonly budget: TurnBudget;
  /** Set when this spend consumed an extra reaction whose granting mechanic
   *  carries a restriction (e.g. hydra Reactive Heads:
   *  "opportunity-attacks"). Whether the activity satisfies it is a DM
   *  ruling; the engine surfaces the clause. */
  readonly extraReactionRestriction?: string;
}

export interface SetReactionAllowanceInput extends TurnMutationContext {
  readonly campaignId: string;
  readonly combatantId: string;
  /** The combatant's current total reactions per round (its normal one plus
   *  the extras its mechanic grants right now, e.g. hydra heads). */
  readonly allowance: number;
}

export interface SetReactionAllowanceResult {
  readonly combatInstanceId: string;
  readonly participant: TurnParticipant;
  readonly reactionAllowance: number;
  /** The granting mechanic's restriction clause, when it carries one. */
  readonly restrictedTo?: string;
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
  readonly reactions_used: number;
  readonly reaction_allowance: number;
  readonly reaction_refresh: ReactionRefresh;
  readonly reaction_activity: string | null;
  readonly free_interaction_used: number;
  readonly free_interaction_activity: string | null;
  readonly movement_note: string | null;
  readonly bonus_action_spell_cast: number;
  readonly other_spell_cast: OtherSpellCast;
}

const BUDGET_COLUMNS = `participant_kind, participant_ref, surprised,
       turns_taken, action_used, action_activity, bonus_action_used,
       bonus_action_activity, reactions_used, reaction_allowance,
       reaction_refresh, reaction_activity,
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
    reactionsUsed: row.reactions_used,
    reactionAllowance: row.reaction_allowance,
    reactionRefresh: row.reaction_refresh,
    reactionActivity: row.reaction_activity ?? undefined,
    freeInteractionUsed: row.free_interaction_used === 1,
    freeInteractionActivity: row.free_interaction_activity ?? undefined,
    movementNote: row.movement_note ?? undefined,
    bonusActionSpellCast: row.bonus_action_spell_cast === 1,
    otherSpellCast: row.other_spell_cast,
  };
}

/**
 * Look up a record in the campaign's resolved rules stack (same binding
 * resolution `start_encounter` uses for creature statlines).
 */
function lookupCampaignRecord(
  db: Db,
  kind: RulesRecordKind,
  ref: string,
): RulesRecord | undefined {
  const binding = readCampaignRulesBinding(db) ?? DEFAULT_DND5E_SRD_BINDING;
  const base =
    [getBundledDnd5eSrdPack(), PATHFINDER2E_REMASTER_RULES_PACK].find(
      (candidate) => candidate.meta.packId === binding.base.packId,
    ) ?? getBundledDnd5eSrdPack();
  const result = lookupRulesRecord(resolveRulesStack({ base }), { kind, ref });
  return result.ok ? result.record : undefined;
}

/** A resolved spell's facts the timing invariant needs, pack-derived. */
interface ResolvedSpell {
  readonly ref: string;
  readonly cantrip: boolean;
  /** True for a cantrip with a casting time of exactly 1 action — the only
   *  other spell permitted on a bonus-action-spell turn. */
  readonly actionCantrip: boolean;
}

function resolveSpell(db: Db, spellRef: string): ResolvedSpell {
  const record = lookupCampaignRecord(db, 'spell', spellRef);
  const data = record?.data;
  if (typeof data !== 'object' || data === null) {
    throw new ActionEconomyError(
      `spellRef '${spellRef}' does not resolve to a spell record in the campaign rules stack; find the exact key via lookup_rules`,
    );
  }
  const level = (data as Record<string, unknown>).level;
  const castingTime = (data as Record<string, unknown>).castingTime;
  if (typeof level !== 'number') {
    throw new ActionEconomyError(
      `spell record '${spellRef}' carries no level; cannot derive cantrip status`,
    );
  }
  const cantrip = level === 0;
  return {
    ref: spellRef,
    cantrip,
    actionCantrip: cantrip && castingTime === '1 action',
  };
}

/** Fail closed when an activity reads like a spell cast but no spellRef was
 *  passed: the timing invariant would otherwise be silently bypassable. */
const SPELL_CAST_ACTIVITY = /\bcast(?:s|ing)?\b|\bspell/i;

/** How a participant's reactions behave, derived from typed extraReactions
 *  mechanics on its creature record (combatants only; characters and
 *  recordless combatants get the SRD default). */
interface ReactionProfile {
  readonly allowance: number;
  readonly refresh: ReactionRefresh;
  /** The record carries a formula-based (state-dependent) grant, so the
   *  validated runtime allowance grant is available. */
  readonly hasFormulaGrant: boolean;
  readonly restrictedTo: string | undefined;
}

const DEFAULT_REACTION_PROFILE: ReactionProfile = {
  allowance: 1,
  refresh: 'own_turn',
  hasFormulaGrant: false,
  restrictedTo: undefined,
};

/** Collect every typed `extraReactions` effect anywhere in a record's data
 *  (traits/actions nest mechanics differently across kinds). */
function collectExtraReactionEffects(
  value: unknown,
  found: Record<string, unknown>[],
): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectExtraReactionEffects(item, found);
    }
    return;
  }
  if (typeof value !== 'object' || value === null) {
    return;
  }
  const record = value as Record<string, unknown>;
  if (record.kind === 'extraReactions') {
    found.push(record);
    return;
  }
  for (const nested of Object.values(record)) {
    collectExtraReactionEffects(nested, found);
  }
}

function reactionProfileFor(
  db: Db,
  rulesRef: string | undefined,
): ReactionProfile {
  if (rulesRef === undefined) {
    return DEFAULT_REACTION_PROFILE;
  }
  const record = lookupCampaignRecord(db, 'creature', rulesRef);
  if (record === undefined) {
    return DEFAULT_REACTION_PROFILE;
  }
  const effects: Record<string, unknown>[] = [];
  collectExtraReactionEffects(record.data, effects);
  if (effects.length === 0) {
    return DEFAULT_REACTION_PROFILE;
  }
  let allowance = 1;
  let refresh: ReactionRefresh = 'own_turn';
  let hasFormulaGrant = false;
  let restrictedTo: string | undefined;
  for (const effect of effects) {
    if (typeof effect.perTurn === 'number' && effect.perTurn >= 1) {
      // "Can take a reaction on every turn": the count refreshes at the
      // start of every turn instead of only the participant's own.
      allowance = Math.max(allowance, effect.perTurn);
      refresh = 'every_turn';
    }
    if (typeof effect.formula === 'string') {
      // State-dependent grant (e.g. one per hydra head beyond one): the
      // engine cannot count heads, so the DM records the current total via
      // the validated setReactionAllowance grant.
      hasFormulaGrant = true;
    }
    if (typeof effect.restrictedTo === 'string') {
      restrictedTo = effect.restrictedTo;
    }
  }
  return { allowance, refresh, hasFormulaGrant, restrictedTo };
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
): {
  participant: TurnParticipant;
  displayLabel: string;
  rulesRef: string | undefined;
} {
  if (input.kind === 'combatant') {
    if (input.ref === undefined || input.ref.length === 0) {
      throw new ActionEconomyError('a combatant participant needs its ref');
    }
    const combatant = db
      .prepare(
        `SELECT combat_instance_id, display_label, status, rules_ref
         FROM encounter_combatant
         WHERE campaign_id = ? AND combatant_id = ?`,
      )
      .get(campaignId, input.ref) as
      | {
          combat_instance_id: string;
          display_label: string;
          status: string;
          rules_ref: string;
        }
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
      rulesRef: combatant.rules_ref,
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
    rulesRef: undefined,
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

/** Insert the participant's budget row if it does not exist yet, seeding the
 *  reaction allowance/refresh from the participant's typed mechanics. */
function ensureBudgetRow(
  db: Db,
  campaignId: string,
  instanceId: string,
  participant: TurnParticipant,
  profile: ReactionProfile,
  ctx: TurnMutationContext,
): void {
  db.prepare(
    `INSERT INTO combat_turn_budget(
       campaign_id, combat_instance_id, participant_kind, participant_ref,
       reaction_allowance, reaction_refresh,
       provenance, session_id, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(campaign_id, combat_instance_id, participant_kind,
                 participant_ref) DO NOTHING`,
  ).run(
    campaignId,
    instanceId,
    participant.kind,
    participant.ref,
    profile.allowance,
    profile.refresh,
    ctx.provenance,
    ctx.sessionId,
    ctx.at,
  );
}

export function beginTurn(db: Db, input: BeginTurnInput): BeginTurnResult {
  return withTransaction(db, (txnDb) => {
    const instance = requireActiveInstance(txnDb, input.campaignId);
    const { participant, displayLabel, rulesRef } = resolveParticipant(
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
    // count resets at the start of its own turn; surprised, turns_taken,
    // and the reaction allowance/refresh survive the reset.
    ensureBudgetRow(
      txnDb,
      input.campaignId,
      instance.combatInstanceId,
      participant,
      reactionProfileFor(txnDb, rulesRef),
      input,
    );
    txnDb
      .prepare(
        `UPDATE combat_turn_budget
         SET action_used = 0, action_activity = NULL,
             bonus_action_used = 0, bonus_action_activity = NULL,
             reactions_used = 0, reaction_activity = NULL,
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

    // perTurn extraReactions mechanics (marilith Reactive) regain their
    // reaction at the start of EVERY turn, not only their own.
    txnDb
      .prepare(
        `UPDATE combat_turn_budget
         SET reactions_used = 0,
             provenance = ?, session_id = ?, updated_at = ?
         WHERE campaign_id = ? AND combat_instance_id = ?
           AND reaction_refresh = 'every_turn' AND reactions_used > 0`,
      )
      .run(
        input.provenance,
        input.sessionId,
        input.at,
        input.campaignId,
        instance.combatInstanceId,
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
  const isSpendableForSpell =
    input.resource === 'action' ||
    input.resource === 'bonus_action' ||
    input.resource === 'reaction';
  if (input.spellRef !== undefined && !isSpendableForSpell) {
    throw new ActionEconomyError(
      'a spell cast spends an action, bonus action, or reaction — not movement or the free interaction',
    );
  }
  if (
    input.spellRef === undefined &&
    isSpendableForSpell &&
    SPELL_CAST_ACTIVITY.test(input.activity)
  ) {
    // Fail closed instead of letting a prose-described cast bypass the
    // bonus-action-spell timing invariant.
    throw new ActionEconomyError(
      `the activity '${input.activity}' reads like a spell cast: pass spellRef (the spell's pack key, e.g. "spell:healing-word") so spell timing is enforced, or reword the activity if no spell is being cast`,
    );
  }

  return withTransaction(db, (txnDb) => {
    const instance = requireActiveInstance(txnDb, input.campaignId);
    const { participant, displayLabel, rulesRef } = resolveParticipant(
      txnDb,
      input.campaignId,
      instance.combatInstanceId,
      input.participant,
    );
    const spell =
      input.spellRef === undefined
        ? undefined
        : resolveSpell(txnDb, input.spellRef);
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

    const profile = reactionProfileFor(txnDb, rulesRef);
    ensureBudgetRow(
      txnDb,
      input.campaignId,
      instance.combatInstanceId,
      participant,
      profile,
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
    let extraReactionRestriction: string | undefined;
    switch (input.resource) {
      case 'action': {
        if (row.action_used === 1) {
          throw new ActionEconomyError(
            `${displayLabel} has already used their action this turn` +
              (row.action_activity === null ? '' : ` (${row.action_activity})`),
          );
        }
        if (spell !== undefined) {
          if (row.bonus_action_spell_cast === 1 && !spell.actionCantrip) {
            throw new ActionEconomyError(
              `${displayLabel} cast a spell as a bonus action this turn: the only other spell allowed is a cantrip with a casting time of 1 action ('${spell.ref}' is not)`,
            );
          }
          updates.other_spell_cast = escalateOtherSpellCast(
            row.other_spell_cast,
            spell.actionCantrip ? 'action-cantrip' : 'other',
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
        if (spell !== undefined) {
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
        if (row.reactions_used >= row.reaction_allowance) {
          const spent =
            row.reaction_allowance === 1
              ? 'their reaction'
              : `all ${row.reaction_allowance} of their reactions (${row.reactions_used}/${row.reaction_allowance})`;
          const returns =
            row.reaction_refresh === 'every_turn'
              ? '; they return when the next turn begins'
              : row.reaction_allowance === 1
                ? '; it returns at the start of their next turn'
                : '; they return at the start of their next turn';
          const grantHint = profile.hasFormulaGrant
            ? ' This creature has a state-dependent extra-reaction mechanic: if its current state grants more, record the total via update_combatant reactionAllowance.'
            : '';
          throw new ActionEconomyError(
            `${displayLabel} has already used ${spent} this round` +
              (row.reaction_activity === null
                ? ''
                : ` (last: ${row.reaction_activity})`) +
              returns +
              grantHint,
          );
        }
        if (spell !== undefined && isOwnTurn) {
          // A reaction spell on the caster's own turn is never a cantrip
          // with a casting time of 1 action, so it participates in the
          // bonus-action-spell restriction both ways.
          if (row.bonus_action_spell_cast === 1) {
            throw new ActionEconomyError(
              `${displayLabel} cast a spell as a bonus action this turn: the only other spell allowed is a cantrip with a casting time of 1 action ('${spell.ref}' cast as a reaction is not)`,
            );
          }
          updates.other_spell_cast = escalateOtherSpellCast(
            row.other_spell_cast,
            'other',
          );
        }
        if (row.reactions_used >= 1 && profile.restrictedTo !== undefined) {
          // Extra reactions may be mechanic-restricted (hydra Reactive
          // Heads: opportunity attacks only). Whether the activity
          // satisfies the clause stays a ruling; the engine surfaces it.
          extraReactionRestriction = profile.restrictedTo;
        }
        updates.reactions_used = row.reactions_used + 1;
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
      ...(extraReactionRestriction === undefined
        ? {}
        : { extraReactionRestriction }),
    };
  });
}

/**
 * Record a combatant's current total reaction allowance — the validated
 * runtime grant for formula-based `extraReactions` mechanics whose value
 * depends on live state the engine does not track (hydra Reactive Heads:
 * one extra reaction per head beyond one). Rejected unless the combatant's
 * creature record structurally carries such a mechanic, so the model cannot
 * invent extra reactions for ordinary creatures.
 */
export function setReactionAllowance(
  db: Db,
  input: SetReactionAllowanceInput,
): SetReactionAllowanceResult {
  if (!Number.isInteger(input.allowance) || input.allowance < 1) {
    throw new ActionEconomyError(
      "reaction allowance must be a positive integer (the creature's current total reactions per round)",
    );
  }

  return withTransaction(db, (txnDb) => {
    const instance = requireActiveInstance(txnDb, input.campaignId);
    const { participant, displayLabel, rulesRef } = resolveParticipant(
      txnDb,
      input.campaignId,
      instance.combatInstanceId,
      { kind: 'combatant', ref: input.combatantId },
    );
    const profile = reactionProfileFor(txnDb, rulesRef);
    if (!profile.hasFormulaGrant) {
      throw new ActionEconomyError(
        `${displayLabel} has no state-dependent extra-reaction mechanic in its rules record; its reaction allowance is fixed`,
      );
    }

    ensureBudgetRow(
      txnDb,
      input.campaignId,
      instance.combatInstanceId,
      participant,
      profile,
      input,
    );
    txnDb
      .prepare(
        `UPDATE combat_turn_budget
         SET reaction_allowance = ?,
             provenance = ?, session_id = ?, updated_at = ?
         WHERE campaign_id = ? AND combat_instance_id = ?
           AND participant_kind = ? AND participant_ref = ?`,
      )
      .run(
        input.allowance,
        input.provenance,
        input.sessionId,
        input.at,
        input.campaignId,
        instance.combatInstanceId,
        participant.kind,
        participant.ref,
      );

    return {
      combatInstanceId: instance.combatInstanceId,
      participant,
      reactionAllowance: input.allowance,
      ...(profile.restrictedTo === undefined
        ? {}
        : { restrictedTo: profile.restrictedTo }),
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
    const turn = readInstanceTurnFields(
      txnDb,
      input.campaignId,
      instance.combatInstanceId,
    );
    const surprised: TurnParticipant[] = [];

    for (const participantInput of input.participants) {
      const { participant, displayLabel, rulesRef } = resolveParticipant(
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
        reactionProfileFor(txnDb, rulesRef),
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
      if (
        turn.active_participant_kind === participant.kind &&
        turn.active_participant_ref === participant.ref
      ) {
        throw new ActionEconomyError(
          `${displayLabel}'s first turn is already underway; surprise must be recorded before it begins`,
        );
      }
      if (
        row !== undefined &&
        (row.action_used === 1 ||
          row.bonus_action_used === 1 ||
          row.reactions_used > 0 ||
          row.free_interaction_used === 1 ||
          row.movement_note !== null)
      ) {
        throw new ActionEconomyError(
          `${displayLabel} has already acted this combat (a surprised creature could not have); surprise must be recorded before any spend`,
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
  const reaction =
    budget.reactionAllowance === 1
      ? slot(budget.reactionsUsed >= 1, 'reaction', budget.reactionActivity)
      : `reactions ${budget.reactionsUsed}/${budget.reactionAllowance} used` +
        (budget.reactionActivity === undefined
          ? ''
          : ` (last: ${budget.reactionActivity})`);
  const parts = [
    slot(budget.actionUsed, 'action', budget.actionActivity),
    slot(budget.bonusActionUsed, 'bonus action', budget.bonusActionActivity),
    reaction,
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
