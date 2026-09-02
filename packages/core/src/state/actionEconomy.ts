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
// - Legendary actions (F5, eshyra-2n1t.7) are a per-round counter on the
//   same budget row: the allowance comes from the creature record (the
//   SRD's "can take 3 legendary actions"), each option's cost from its
//   typed `legendaryActionCost` (default 1), spends are legal only on
//   OTHER creatures' turns ("only at the end of another creature's turn"
//   stays a timing ruling; the engine enforces not-own-turn and the
//   budget), a surprised legendary creature regains access only after its
//   first turn (the shared surprised gate), and spent actions are regained
//   when the creature's own turn begins (legendary-actions).
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
// a ruling), so the round counter only enforces monotonicity. `beginTurn` is
// also the atomic F2/F3 seam: after the new round and budget are durable it
// asks F3 to settle engine-evaluable deadlines. F2 owns the boundary/budget;
// F3 owns timer validation, cleanup, and terminal events.

import type { Db } from '../persistence/db.js';
import { withTransaction } from '../persistence/db.js';
import { resolveCharacterId } from './activeCharacter.js';
import type { TurnBoundaryEffectSummary } from './activeEffects.js';
import { settleEffectsAtTurnBoundary } from './activeEffects.js';
import {
  type CampaignRulesPackResolver,
  lookupCampaignRecord,
} from './campaignRecordLookup.js';
import {
  getActiveCombatInstance,
  listCombatantsForInstance,
} from './encounterCombatants.js';
import type { LifeState } from './hpLifecycle.js';
import { replaceParentheticals } from './parentheticalNames.js';
import { readCompletedTurns } from './turnClock.js';

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
  | 'movement'
  | 'legendary_action';

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
  /** Legendary actions per round (0 = not a legendary creature). */
  readonly legendaryActionAllowance: number;
  readonly legendaryActionsUsed: number;
  readonly legendaryActionActivity: string | undefined;
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
  readonly resolveRulesPack?: CampaignRulesPackResolver;
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
  readonly turnAvailable: boolean;
  readonly participantUnavailableReason?: string;
  readonly boundaryEffects: readonly TurnBoundaryEffectSummary[];
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
  /** Required for a legendary_action spend: the legendary option's name as
   *  the statblock prints it (e.g. "Wing Attack"). The engine derives the
   *  action cost from the record; an unmatched name fails closed. */
  readonly legendaryActionName?: string;
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
  readonly legendary_action_allowance: number;
  readonly legendary_actions_used: number;
  readonly legendary_action_activity: string | null;
  readonly legendary_last_spend_token: string | null;
}

const BUDGET_COLUMNS = `participant_kind, participant_ref, surprised,
       turns_taken, action_used, action_activity, bonus_action_used,
       bonus_action_activity, reactions_used, reaction_allowance,
       reaction_refresh, reaction_activity,
       free_interaction_used, free_interaction_activity, movement_note,
       bonus_action_spell_cast, other_spell_cast,
       legendary_action_allowance, legendary_actions_used,
       legendary_action_activity, legendary_last_spend_token`;

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
    legendaryActionAllowance: row.legendary_action_allowance,
    legendaryActionsUsed: row.legendary_actions_used,
    legendaryActionActivity: row.legendary_action_activity ?? undefined,
  };
}

/** A resolved spell's facts the timing invariant needs, pack-derived. */
interface ResolvedSpell {
  readonly ref: string;
  readonly cantrip: boolean;
  /** True for a cantrip with a casting time of exactly 1 action — the only
   *  other spell permitted on a bonus-action-spell turn. */
  readonly actionCantrip: boolean;
}

function resolveSpell(
  db: Db,
  spellRef: string,
  resolver?: CampaignRulesPackResolver,
): ResolvedSpell {
  const record = lookupCampaignRecord(db, 'spell', spellRef, resolver);
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
  resolver?: CampaignRulesPackResolver,
): ReactionProfile {
  if (rulesRef === undefined) {
    return DEFAULT_REACTION_PROFILE;
  }
  const record = lookupCampaignRecord(db, 'creature', rulesRef, resolver);
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

/** A legendary creature's per-round action economy, derived from its
 *  record's `legendaryActions` block (F5). Allowance 0 = not legendary. */
interface LegendaryProfile {
  readonly allowance: number;
  readonly options: readonly { name: string; cost: number }[];
}

const NO_LEGENDARY_PROFILE: LegendaryProfile = { allowance: 0, options: [] };

/** The SRD states the allowance in the block's boilerplate ("The dragon can
 *  take 3 legendary actions..."); every SRD legendary creature says 3, so 3
 *  is also the fallback when the sentence is absent. */
const LEGENDARY_COUNT_RE = /take (\d+|one|two|three|four|five) legendary/i;
const COUNT_WORDS: Readonly<Record<string, number>> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
};

/** Normalize a legendary option name for matching: the "(Costs 2 Actions)"
 *  suffix is cost metadata, not identity. */
function normalizeLegendaryName(name: string): string {
  return replaceParentheticals(name, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function legendaryProfileFor(
  db: Db,
  rulesRef: string | undefined,
  resolver?: CampaignRulesPackResolver,
): LegendaryProfile {
  if (rulesRef === undefined) {
    return NO_LEGENDARY_PROFILE;
  }
  const record = lookupCampaignRecord(db, 'creature', rulesRef, resolver);
  const data = record?.data;
  if (typeof data !== 'object' || data === null) {
    return NO_LEGENDARY_PROFILE;
  }
  const block = (data as Record<string, unknown>).legendaryActions;
  if (typeof block !== 'object' || block === null) {
    return NO_LEGENDARY_PROFILE;
  }
  const blockRecord = block as Record<string, unknown>;
  const description =
    typeof blockRecord.description === 'string' ? blockRecord.description : '';
  const countMatch = LEGENDARY_COUNT_RE.exec(description);
  const allowance =
    countMatch === null
      ? 3
      : (COUNT_WORDS[countMatch[1].toLowerCase()] ?? Number(countMatch[1]));
  const options: { name: string; cost: number }[] = [];
  if (Array.isArray(blockRecord.entries)) {
    for (const entryValue of blockRecord.entries) {
      if (typeof entryValue !== 'object' || entryValue === null) {
        continue;
      }
      const entry = entryValue as Record<string, unknown>;
      if (typeof entry.name !== 'string') {
        continue;
      }
      const mechanics =
        typeof entry.mechanics === 'object' && entry.mechanics !== null
          ? (entry.mechanics as Record<string, unknown>)
          : undefined;
      const usage =
        typeof mechanics?.usage === 'object' && mechanics.usage !== null
          ? (mechanics.usage as Record<string, unknown>)
          : undefined;
      const cost =
        typeof usage?.legendaryActionCost === 'number' &&
        usage.legendaryActionCost >= 1
          ? usage.legendaryActionCost
          : 1;
      options.push({ name: entry.name, cost });
    }
  }
  return { allowance, options };
}

/**
 * Resolve and validate a participant against the active combat instance:
 * a combatant must be a live member of that instance; a character ref (or
 * its acting-character default) must resolve, and the dead take no turns.
 * Returns the concrete participant plus a display label for results.
 */
interface BoundaryParticipant {
  readonly participant: TurnParticipant;
  readonly displayLabel: string;
  readonly rulesRef: string | undefined;
  readonly unavailableReason?: string;
}

function resolveBoundaryParticipant(
  db: Db,
  campaignId: string,
  combatInstanceId: string,
  input: TurnParticipantInput,
): BoundaryParticipant {
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
    return {
      participant: { kind: 'combatant', ref: input.ref },
      displayLabel: combatant.display_label,
      rulesRef: combatant.rules_ref,
      ...(combatant.status === 'dead' ||
      combatant.status === 'escaped' ||
      combatant.status === 'inactive'
        ? {
            unavailableReason: `combatant '${input.ref}' is ${combatant.status} and has no actionable turn`,
          }
        : {}),
    };
  }

  const charId = resolveCharacterId(db, input.ref);
  const character = db
    .prepare('SELECT name, life_state FROM character WHERE id = ?')
    .get(charId) as { name: string | null; life_state: LifeState } | undefined;
  if (character === undefined) {
    throw new ActionEconomyError(`no character row exists for '${charId}'`);
  }
  return {
    participant: { kind: 'character', ref: charId },
    displayLabel: character.name ?? charId,
    rulesRef: undefined,
    ...(character.life_state === 'dead'
      ? {
          unavailableReason: `character '${character.name ?? charId}' is dead and has no actionable turn`,
        }
      : {}),
  };
}

function resolveParticipant(
  db: Db,
  campaignId: string,
  combatInstanceId: string,
  input: TurnParticipantInput,
): Omit<BoundaryParticipant, 'unavailableReason'> {
  const boundary = resolveBoundaryParticipant(
    db,
    campaignId,
    combatInstanceId,
    input,
  );
  if (boundary.unavailableReason !== undefined) {
    throw new ActionEconomyError(boundary.unavailableReason);
  }
  return boundary;
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
 *  reaction allowance/refresh and the legendary-action allowance from the
 *  participant's typed mechanics. A pre-existing row whose legendary
 *  allowance is 0 while the record grants one is lazily reconciled: rows
 *  created before migration 0007 (or before the record carried the block)
 *  would otherwise stay at the column default forever, since the insert is
 *  DO NOTHING. The allowance is only ever record-derived, so raising a 0 is
 *  safe and never clobbers runtime state. */
function ensureBudgetRow(
  db: Db,
  campaignId: string,
  instanceId: string,
  participant: TurnParticipant,
  profile: ReactionProfile,
  legendary: LegendaryProfile,
  ctx: TurnMutationContext,
): void {
  db.prepare(
    `INSERT INTO combat_turn_budget(
       campaign_id, combat_instance_id, participant_kind, participant_ref,
       reaction_allowance, reaction_refresh, legendary_action_allowance,
       provenance, session_id, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(campaign_id, combat_instance_id, participant_kind,
                 participant_ref) DO NOTHING`,
  ).run(
    campaignId,
    instanceId,
    participant.kind,
    participant.ref,
    profile.allowance,
    profile.refresh,
    legendary.allowance,
    ctx.provenance,
    ctx.sessionId,
    ctx.at,
  );
  if (legendary.allowance > 0) {
    db.prepare(
      `UPDATE combat_turn_budget
       SET legendary_action_allowance = ?,
           provenance = ?, session_id = ?, updated_at = ?
       WHERE campaign_id = ? AND combat_instance_id = ?
         AND participant_kind = ? AND participant_ref = ?
         AND legendary_action_allowance = 0`,
    ).run(
      legendary.allowance,
      ctx.provenance,
      ctx.sessionId,
      ctx.at,
      campaignId,
      instanceId,
      participant.kind,
      participant.ref,
    );
  }
}

function completeParticipantTurn(
  db: Db,
  campaignId: string,
  combatInstanceId: string,
  participant: TurnParticipant,
  ctx: TurnMutationContext,
): void {
  db.prepare(
    `UPDATE combat_turn_budget
     SET turns_taken = turns_taken + 1, surprised = 0,
         provenance = ?, session_id = ?, updated_at = ?
     WHERE campaign_id = ? AND combat_instance_id = ?
       AND participant_kind = ? AND participant_ref = ?`,
  ).run(
    ctx.provenance,
    ctx.sessionId,
    ctx.at,
    campaignId,
    combatInstanceId,
    participant.kind,
    participant.ref,
  );
}

export function beginTurn(db: Db, input: BeginTurnInput): BeginTurnResult {
  return withTransaction(db, (txnDb) => {
    const instance = requireActiveInstance(txnDb, input.campaignId);
    const boundaryIdentity = resolveBoundaryParticipant(
      txnDb,
      input.campaignId,
      instance.combatInstanceId,
      input.participant,
    );
    const { participant, displayLabel, rulesRef } = boundaryIdentity;

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
      completeParticipantTurn(
        txnDb,
        input.campaignId,
        instance.combatInstanceId,
        {
          kind: turn.active_participant_kind,
          ref: turn.active_participant_ref,
        },
        input,
      );
    }

    // Update the durable boundary marker before any F3 settlement. This makes
    // round clocks observe the requested round even when cleanup cascades.
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

    // Reset the new participant's per-turn budget in place. The reaction
    // count resets at the start of its own turn, and a legendary creature
    // regains its spent legendary actions (legendary-actions); surprised,
    // turns_taken, and the reaction/legendary allowances survive the reset.
    ensureBudgetRow(
      txnDb,
      input.campaignId,
      instance.combatInstanceId,
      participant,
      reactionProfileFor(txnDb, rulesRef, input.resolveRulesPack),
      legendaryProfileFor(txnDb, rulesRef, input.resolveRulesPack),
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
             legendary_actions_used = 0, legendary_action_activity = NULL,
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

    const enteringTurnOrdinal =
      readCompletedTurns(
        txnDb,
        input.campaignId,
        instance.combatInstanceId,
        participant,
      ) + 1;
    const boundaryEffects = settleEffectsAtTurnBoundary(txnDb, {
      campaignId: input.campaignId,
      combatInstanceId: instance.combatInstanceId,
      roundNumber: round,
      participant,
      enteringTurnOrdinal,
      provenance: input.provenance,
      sessionId: input.sessionId,
      at: input.at,
    });

    const currentBoundaryIdentity = resolveBoundaryParticipant(
      txnDb,
      input.campaignId,
      instance.combatInstanceId,
      input.participant,
    );
    const turnAvailable =
      currentBoundaryIdentity.unavailableReason === undefined;
    const participantUnavailableReason =
      currentBoundaryIdentity.unavailableReason;
    if (!turnAvailable) {
      txnDb
        .prepare(
          `UPDATE combat_instance
           SET active_participant_kind = NULL, active_participant_ref = NULL,
               provenance = ?, session_id = ?, updated_at = ?
           WHERE campaign_id = ? AND combat_instance_id = ?`,
        )
        .run(
          input.provenance,
          input.sessionId,
          input.at,
          input.campaignId,
          instance.combatInstanceId,
        );
      completeParticipantTurn(
        txnDb,
        input.campaignId,
        instance.combatInstanceId,
        participant,
        input,
      );
    }

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
      turnAvailable,
      ...(participantUnavailableReason === undefined
        ? {}
        : { participantUnavailableReason }),
      boundaryEffects,
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
    input.resource === 'reaction' ||
    input.resource === 'legendary_action';
  if (input.spellRef !== undefined && !isSpendableForSpell) {
    throw new ActionEconomyError(
      'a spell cast spends an action, bonus action, reaction, or legendary action — not movement or the free interaction',
    );
  }
  if (
    input.legendaryActionName !== undefined &&
    input.resource !== 'legendary_action'
  ) {
    throw new ActionEconomyError(
      'legendaryActionName applies only to a legendary_action spend',
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
        : resolveSpell(txnDb, input.spellRef, input.resolveRulesPack);
    const turn = readInstanceTurnFields(
      txnDb,
      input.campaignId,
      instance.combatInstanceId,
    );

    const isOwnTurn =
      turn.active_participant_kind === participant.kind &&
      turn.active_participant_ref === participant.ref;
    if (
      input.resource !== 'reaction' &&
      input.resource !== 'legendary_action' &&
      !isOwnTurn
    ) {
      throw new ActionEconomyError(
        `it is not ${displayLabel}'s turn; only a reaction or legendary action can be spent off-turn (call begin_turn when their turn starts)`,
      );
    }
    if (input.resource === 'legendary_action' && isOwnTurn) {
      throw new ActionEconomyError(
        `legendary actions can be used only at the end of ANOTHER creature's turn, and it is ${displayLabel}'s own turn`,
      );
    }

    const profile = reactionProfileFor(txnDb, rulesRef, input.resolveRulesPack);
    const legendaryProfile = legendaryProfileFor(
      txnDb,
      rulesRef,
      input.resolveRulesPack,
    );
    ensureBudgetRow(
      txnDb,
      input.campaignId,
      instance.combatInstanceId,
      participant,
      profile,
      legendaryProfile,
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
      case 'legendary_action': {
        if (row.legendary_action_allowance === 0) {
          throw new ActionEconomyError(
            `${displayLabel} has no legendary actions in its rules record`,
          );
        }
        if (
          turn.active_participant_kind === null ||
          turn.active_participant_ref === null
        ) {
          throw new ActionEconomyError(
            "legendary actions are used at the end of another creature's turn, and no structured turn is open (begin_turn first)",
          );
        }
        // Only one legendary action option can be used at a time, at the
        // end of one creature's turn: the spend is stamped with the current
        // turn window (round + active participant + its turn count) and a
        // second option inside the same window is refused.
        const activeBudget = readBudgetRow(
          txnDb,
          input.campaignId,
          instance.combatInstanceId,
          {
            kind: turn.active_participant_kind,
            ref: turn.active_participant_ref,
          },
        );
        const windowToken =
          `${turn.round_number}:${turn.active_participant_kind}:` +
          `${turn.active_participant_ref}:t${activeBudget?.turns_taken ?? 0}`;
        if (row.legendary_last_spend_token === windowToken) {
          throw new ActionEconomyError(
            `${displayLabel} has already used a legendary action option at the end of this turn` +
              (row.legendary_action_activity === null
                ? ''
                : ` (${row.legendary_action_activity})`) +
              "; only one option can be used at a time — the next opportunity is the end of another creature's turn",
          );
        }
        if (input.legendaryActionName === undefined) {
          const names = legendaryProfile.options
            .map((option) => option.name)
            .join(', ');
          throw new ActionEconomyError(
            `pass legendaryActionName (the legendary option used) so its cost comes from the record. Options: ${names || '(none listed)'}`,
          );
        }
        const wanted = normalizeLegendaryName(input.legendaryActionName);
        const option = legendaryProfile.options.find(
          (candidate) => normalizeLegendaryName(candidate.name) === wanted,
        );
        if (option === undefined) {
          const names = legendaryProfile.options
            .map((candidate) => candidate.name)
            .join(', ');
          throw new ActionEconomyError(
            `'${input.legendaryActionName}' is not a legendary option in ${displayLabel}'s record. Options: ${names || '(none listed)'}`,
          );
        }
        const remaining =
          row.legendary_action_allowance - row.legendary_actions_used;
        if (option.cost > remaining) {
          throw new ActionEconomyError(
            `${displayLabel} has ${remaining} of ${row.legendary_action_allowance} legendary actions left this round` +
              (row.legendary_action_activity === null
                ? ''
                : ` (last: ${row.legendary_action_activity})`) +
              `; '${option.name}' costs ${option.cost}. Spent actions return at the start of its turn`,
          );
        }
        // A legendary-action spell cast happens between turns, so it does
        // not participate in the owner's on-turn bonus-action-spell timing
        // invariant; the spell was still resolved above, so a bogus ref
        // fails closed.
        updates.legendary_actions_used =
          row.legendary_actions_used + option.cost;
        updates.legendary_action_activity = input.activity;
        updates.legendary_last_spend_token = windowToken;
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
      legendaryProfileFor(txnDb, rulesRef),
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
        legendaryProfileFor(txnDb, rulesRef),
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
          // The every_turn refresh (perTurn extraReactions) zeroes
          // reactions_used at each turn start, but the retained activity
          // still evidences a pre-first-turn reaction — a surprised
          // creature could not have taken it.
          row.reaction_activity !== null ||
          row.free_interaction_used === 1 ||
          row.movement_note !== null ||
          // Same evidence logic for legendary actions: beginTurn zeroes the
          // count, but a retained activity proves a pre-first-turn spend.
          row.legendary_actions_used > 0 ||
          row.legendary_action_activity !== null)
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
  if (budget.legendaryActionAllowance > 0) {
    parts.push(
      `legendary actions ${budget.legendaryActionsUsed}/${budget.legendaryActionAllowance} used` +
        (budget.legendaryActionActivity === undefined
          ? ''
          : ` (last: ${budget.legendaryActionActivity})`),
    );
  }
  return parts.join(', ');
}
