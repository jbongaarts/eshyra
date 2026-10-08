// Active-effect lifecycle & concentration state machine (eshyra-2n1t.5,
// engine family F3; source: docs/audits/dnd5e-srd-5.1-final/
// 2026-07-06-o9bd-18-7-8-execution-boundary-classification.md §4; design:
// docs/active-effect-lifecycle.md).
//
// One canonical durable lifecycle for effects that persist across turns and
// must later be ended: concentration spells, non-concentration timed spells,
// condition packages, curses, summon control, wards, transformations, and
// activated item powers. Code-owned so the model can never silently violate:
//
// - At most one live concentration effect per owner; starting a new one ends
//   the prior deterministically (concentration).
// - The concentration save DC is max(10, floor(damage/2)) per damage EVENT —
//   computed from the damage dealt, never the net HP delta (temp HP reduce
//   the loss, not the event). The d20 is rolled through the F9 resolve_check
//   seam; this module validates the outcome evidence and owns the break.
// - Losing concentration from incapacitation/death is a one-way reaction to
//   the F6 life-state machine (hpLifecycle calls the hook); F3 never
//   duplicates life state.
// - Every timer records quantity + semantic unit + explicit anchor; round-
//   unit timers anchor to the active combat instance and are code-evaluable.
// - Ending an effect cleans up exactly the projections it owns, in the same
//   transaction, with separate end-vs-concentration-break cleanup policies
//   per link (the Conjure Elemental distinction: a broken conjuration can
//   release its elemental where an ordinary end removes it).
// - No mutation happens before validation succeeds; failed operations leave
//   canonical state, projections, and the audit ledger untouched.
//
// `kind` is a semantic license, not a label (the reviewed S1 profile
// pattern): it limits which source kinds, link kinds, and concentration
// semantics an effect may declare, so structurally valid but meaningless
// combinations fail closed. Zone and form projections are durable canonical
// state and use the same ownership cleanup contract as conditions and actors.

import type { Db } from '../persistence/db.js';
import { withTransaction } from '../persistence/db.js';
import { jsonColumn } from '../persistence/jsonColumn.js';
import type { RulesRecord } from '../rules/types.js';
import {
  type CampaignRulesPackResolver,
  lookupCampaignRecord,
} from './campaignRecordLookup.js';
import {
  describeZeroHpRule,
  leavesPlayAtZeroHp,
  type ZeroHpRule,
} from './combatantLifecycle.js';
import { addCondition, removeCondition } from './domainMutations.js';
import {
  EncounterCombatantError,
  ensureCampaignActorFromCombatant,
  findLiveActorCombatantId,
  getActiveCombatInstance,
  getCampaignActor,
  moveBondedCreatureOutOfPlay,
  recallPocketedCampaignActor,
  removeCampaignActorFromPlay,
  removeCombatantFromPlay,
  restoreBondedCampaignActor,
  revertCampaignActorToNaturalForm,
  revertCombatantToNaturalForm,
  setCombatantZeroHpRule,
  updateCampaignActor,
  updateCombatant,
} from './encounterCombatants.js';
import type { CharacterConditionEntry } from './liveStateSchema.js';
import { validateConditionsJson } from './liveStateSchema.js';
import { MutateStateError } from './mutateState.js';
import { readAnchorTurnOrdinal } from './turnClock.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const ACTIVE_EFFECT_KINDS = [
  'spell-effect',
  'summoning',
  'ward',
  'curse',
  'transformation',
  'item-power',
  'condition-package',
] as const;
export type ActiveEffectKind = (typeof ACTIVE_EFFECT_KINDS)[number];

export const EFFECT_SOURCE_KINDS = [
  'spell',
  'magic-item',
  'feature',
  'creature-trait',
  'hazard',
  'ruling',
] as const;
export type EffectSourceKind = (typeof EFFECT_SOURCE_KINDS)[number];

export type EffectParticipantKind =
  | 'character'
  | 'combatant'
  | 'campaign_actor';

export interface EffectParticipant {
  readonly kind: EffectParticipantKind;
  readonly ref: string;
}

export const EFFECT_DURATION_UNITS = [
  'round',
  'minute',
  'hour',
  'day',
] as const;
export type EffectDurationUnit = (typeof EFFECT_DURATION_UNITS)[number];

export const EFFECT_ANCHOR_KINDS = [
  'spell-cast',
  'effect-created',
  'trigger-occurred',
  'source-turn-start',
  'target-turn-start',
] as const;
export type EffectAnchorKind = (typeof EFFECT_ANCHOR_KINDS)[number];

export const SUPPORTED_EFFECT_ANCHOR_KINDS: readonly EffectAnchorKind[] = [
  'spell-cast',
  'effect-created',
  'trigger-occurred',
  'source-turn-start',
  'target-turn-start',
];

/** Typed duration: every timer names quantity + semantic unit + anchor. */
export type EffectDurationInput =
  | {
      readonly kind: 'timed';
      readonly amount: number;
      readonly unit: EffectDurationUnit;
      readonly anchor: EffectAnchorKind;
      readonly anchorTrigger?: string;
    }
  | { readonly kind: 'until-dismissed' }
  | { readonly kind: 'until-removed' }
  | { readonly kind: 'until-trigger'; readonly trigger: string };

export type EffectStatus = 'active' | 'suppressed' | 'ended';

export const EFFECT_END_REASONS = [
  'expired',
  'dismissed',
  'concentration-broken',
  'dispelled',
  'replaced',
  'source-removed',
  'ruled',
] as const;
export type EffectEndReason = (typeof EFFECT_END_REASONS)[number];

export const CONCENTRATION_BREAK_CAUSES = [
  'voluntary',
  'damage-save-failed',
  'incapacitated',
  'dead',
  'new-concentration',
  'forced',
  'owner-removed',
] as const;
export type ConcentrationBreakCause =
  (typeof CONCENTRATION_BREAK_CAUSES)[number];

/** Break causes callers may pass to {@link endActiveEffect} directly; the
 *  evidence-gated causes are reachable only through their owning paths
 *  (resolveConcentrationCheck, the create replacement path, the F6 hook). */
export const DIRECT_CONCENTRATION_BREAK_CAUSES: readonly ConcentrationBreakCause[] =
  ['voluntary', 'forced'];

export type EffectLinkKind = 'condition' | 'actor' | 'zone' | 'form';
/** What an owned projection's cleanup does: 'remove' takes it out of play,
 *  'release' drops ownership and leaves it, 'revert' (actor links carrying a
 *  natural form only) restores the creature's natural form and leaves it in
 *  play. */
export type EffectCleanupPolicy = 'remove' | 'release' | 'revert';

/** A creature's natural form, recorded when a transformation spell (Giant
 *  Insect) changes it: the hit points it had and its rules reference, which
 *  reversion restores exactly. */
export interface NaturalForm {
  readonly hpCurrent: number;
  readonly hpMax: number;
  readonly rulesRef: string;
}
export type EffectTargetKind =
  | 'character'
  | 'combatant'
  | 'campaign_actor'
  | 'scope';

export interface EffectMutationContext {
  readonly provenance: string;
  readonly sessionId: string;
  readonly at: string;
  readonly resolveRulesPack?: CampaignRulesPackResolver;
}

export interface EffectTargetInput {
  readonly kind: EffectTargetKind;
  readonly ref: string;
}

export interface EffectConditionProjectionInput {
  readonly target: EffectParticipant;
  /** Condition entry to project (same shape conditions_json stores). */
  readonly condition: CharacterConditionEntry;
  readonly cleanupOnEnd?: EffectCleanupPolicy;
  readonly cleanupOnBreak?: EffectCleanupPolicy;
}

export interface EffectActorLinkInput {
  /** Combatant the effect owns (summoned/animated/controlled entity). */
  readonly combatantId: string;
  /** Explicit durable identity; omitted means instance-only ownership. */
  readonly campaignActorId?: string;
  readonly cleanupOnEnd?: EffectCleanupPolicy;
  readonly cleanupOnBreak?: EffectCleanupPolicy;
  /** What the creature's own rules say happens at 0 hit points. Derived from
   *  the spell record for spell-sourced effects; declare it for a
   *  ruling-sourced creature that disappears: 'vanish-bonded' when it stays
   *  bonded and the same creature can return (Find Familiar, Find Steed),
   *  'vanish' when its part of the effect ends. A declaration that
   *  contradicts the record is refused. */
  readonly atZeroHitPoints?: 'vanish' | 'vanish-bonded';
  /** The creature's natural form at cast. REQUIRED when the spell record's
   *  0-hit-point rule is 'revert-form' (Giant Insect: the creature returns
   *  to this form on reversion), REFUSED otherwise. */
  readonly naturalForm?: NaturalForm;
}

export interface EffectZoneProjectionInput {
  readonly zoneId: string;
  readonly scopeRef: string;
  readonly shape: 'sphere' | 'cube' | 'cylinder' | 'cone' | 'line';
  readonly sizeFeet: number;
  readonly cleanupOnEnd?: EffectCleanupPolicy;
  readonly cleanupOnBreak?: EffectCleanupPolicy;
}

export interface EffectFormProjectionInput {
  readonly target: EffectParticipant;
  readonly formRef: string;
  readonly cleanupOnEnd?: EffectCleanupPolicy;
  readonly cleanupOnBreak?: EffectCleanupPolicy;
}

export interface CreateActiveEffectInput extends EffectMutationContext {
  readonly campaignId: string;
  /** Caller-supplied stable identity, unique per campaign. */
  readonly effectId: string;
  readonly kind: ActiveEffectKind;
  readonly displayName: string;
  readonly source: {
    readonly kind: EffectSourceKind;
    /** Pack record key. Required (and must resolve) for 'spell'; optional
     *  but resolution-checked for 'magic-item'. */
    readonly ref?: string;
    readonly actor?: EffectParticipant;
  };
  /** Present iff the effect requires concentration. */
  readonly concentration?: { readonly owner: EffectParticipant };
  readonly duration: EffectDurationInput;
  readonly dismissible?: boolean;
  readonly targets?: readonly EffectTargetInput[];
  readonly conditions?: readonly EffectConditionProjectionInput[];
  readonly actors?: readonly EffectActorLinkInput[];
  readonly zones?: readonly EffectZoneProjectionInput[];
  readonly forms?: readonly EffectFormProjectionInput[];
}

export interface EffectTargetView {
  readonly kind: EffectTargetKind;
  readonly ref: string;
  readonly status: 'active' | 'removed';
  readonly removedReason?: string;
  readonly removedAt?: string;
}

export interface EffectLinkView {
  readonly linkKind: EffectLinkKind;
  readonly target: EffectTargetInput;
  readonly projectionRef: string;
  readonly campaignActorId?: string;
  readonly cleanupOnEnd: EffectCleanupPolicy;
  readonly cleanupOnBreak: EffectCleanupPolicy;
  /** Natural form recorded on a transformation actor link. */
  readonly naturalForm?: NaturalForm;
  readonly status: 'active' | 'removed' | 'released';
  readonly removedReason?: string;
  readonly removedAt?: string;
}

export interface EffectDurationView {
  readonly kind: EffectDurationInput['kind'];
  readonly amount?: number;
  readonly unit?: EffectDurationUnit;
  readonly anchorKind?: EffectAnchorKind;
  readonly anchorAt?: string;
  readonly anchorGameTime?: string;
  readonly anchorCombatInstanceId?: string;
  readonly anchorRound?: number;
  readonly anchorParticipant?: EffectParticipant;
  readonly anchorParticipantTurnOrdinal?: number;
  readonly deadlineParticipantTurnOrdinal?: number;
  /** Round the effect expires at (round-unit timers): anchor + amount. */
  readonly deadlineRound?: number;
  /** Elapsed world minute deadline for minute/hour/day timers. */
  readonly deadlineElapsedMinutes?: number;
  readonly trigger?: string;
  readonly anchorTrigger?: string;
}

export interface ActiveEffectView {
  readonly campaignId: string;
  readonly effectId: string;
  readonly kind: ActiveEffectKind;
  readonly displayName: string;
  readonly source: {
    readonly kind: EffectSourceKind;
    readonly ref?: string;
    readonly actor?: EffectParticipant;
  };
  readonly requiresConcentration: boolean;
  readonly concentrationOwner?: EffectParticipant;
  readonly duration: EffectDurationView;
  readonly dismissible: boolean;
  readonly status: EffectStatus;
  readonly endReason?: EffectEndReason;
  readonly endDetail?: string;
  readonly endedAt?: string;
  readonly createdAt: string;
  readonly targets: readonly EffectTargetView[];
  readonly links: readonly EffectLinkView[];
}

/** One owned-projection cleanup outcome recorded in the audit ledger. */
export interface EffectCleanupAction {
  readonly linkKind: EffectLinkKind;
  readonly target: EffectTargetInput;
  readonly projectionRef: string;
  /** 'removed' = projection deleted (an owned creature is taken out of play,
   *  status absent); 'released' = ownership dropped, state left in place
   *  (only ever from a stored 'release' policy); 'reverted' = the creature
   *  returned to its recorded natural form and stays in play (only ever from
   *  a stored 'revert' policy); 'missing' = the projection's holder no longer
   *  exists / is unreachable, so only the link record was closed. */
  readonly action: 'removed' | 'released' | 'reverted' | 'missing';
}

export interface EffectCleanupSummary {
  readonly links: readonly EffectCleanupAction[];
  readonly targetsRemoved: number;
  /** Set when a concentration break released an owned creature whose spell
   *  record removes it one hour after casting once uncontrolled (Conjure
   *  Elemental, Conjure Fey): the id of the non-concentration, non-dismissible
   *  successor effect that now owns it and carries the cast-anchored deadline. */
  readonly successorEffectId?: string;
}

export interface CreateActiveEffectResult {
  readonly effect: ActiveEffectView;
  /** Set when creating this concentration effect ended a prior one. */
  readonly replaced?: {
    readonly effectId: string;
    readonly displayName: string;
    readonly cleanup: EffectCleanupSummary;
  };
}

export interface EndActiveEffectInput extends EffectMutationContext {
  readonly campaignId: string;
  readonly effectId: string;
  readonly reason: EffectEndReason;
  /** Concentration break cause; required iff reason is
   *  'concentration-broken' (direct causes only — see
   *  {@link DIRECT_CONCENTRATION_BREAK_CAUSES}). */
  readonly detail?: string;
  /** Free-text audit note; required for reason 'ruled'. */
  readonly note?: string;
  /** The semantic trigger that fired; required to expire an
   *  'until-trigger' effect and must match its declared trigger. */
  readonly trigger?: string;
}

export interface EndActiveEffectResult {
  readonly changed: boolean;
  readonly effect: ActiveEffectView;
  readonly cleanup: EffectCleanupSummary;
}

/**
 * Verifiable evidence of the Constitution save the engine rolled (the F9
 * d20 seam). The outcome is never declared: it is derived here from
 * `total >= vs` after the evidence itself is validated for internal
 * consistency (dice form, kept-die selection, arithmetic, and the DC).
 */
export interface ConcentrationSaveEvidence {
  /** DC the save was resolved against — must equal the engine-computed DC. */
  readonly vs: number;
  /** Expression rolled: 1d20, 2d20kh1 (advantage), or 2d20kl1. */
  readonly dice: string;
  /** Every d20 generated (two under advantage/disadvantage). */
  readonly rolls: readonly number[];
  /** The kept die — must match the dice expression's selection rule. */
  readonly natural: number;
  /** Σ declared modifiers + applied proficiency. */
  readonly modifierTotal: number;
  /** natural + modifierTotal. */
  readonly total: number;
}

export interface ConcentrationCheckInput extends EffectMutationContext {
  readonly campaignId: string;
  readonly owner: EffectParticipant;
  /** Full damage of the event (before temp-HP absorption). */
  readonly damage: number;
  readonly save: ConcentrationSaveEvidence;
}

export interface ConcentrationCheckResult {
  readonly effectId: string;
  readonly displayName: string;
  readonly dc: number;
  /** Derived by the engine from the validated evidence: total >= dc. */
  readonly outcome: 'success' | 'failure';
  readonly broken: boolean;
  readonly cleanup?: EffectCleanupSummary;
}

export interface RemoveEffectTargetInput extends EffectMutationContext {
  readonly campaignId: string;
  readonly effectId: string;
  readonly target: EffectTargetInput;
  /** Why this target left the effect (e.g. 'saved', 'ruled'). */
  readonly reason: string;
}

export interface RemoveEffectTargetResult {
  readonly changed: boolean;
  /** True when this removal's cleanup cascaded back and ENDED the effect:
   *  the requested non-terminal transition was superseded by a terminal one
   *  (the target row still carries this removal's provenance; the terminal
   *  'ended' event closed the ledger). */
  readonly superseded?: boolean;
  readonly effect: ActiveEffectView;
  readonly cleanup: readonly EffectCleanupAction[];
}

export interface RefreshEffectInput extends EffectMutationContext {
  readonly campaignId: string;
  readonly effectId: string;
  /** New duration; omitted re-anchors the existing one. */
  readonly duration?: EffectDurationInput;
  readonly note?: string;
}

export interface RecastBondedSummonInput extends EffectMutationContext {
  readonly campaignId: string;
  readonly effectId: string;
  /** The spell record whose cast-again transition governs the restoration. */
  readonly spellRef: string;
  /** The new form's creature ref: required by a select-new-form recast,
   *  refused by a restore-same-actor recast. */
  readonly form?: string;
}

export interface RecastBondedSummonResult {
  readonly effect: ActiveEffectView;
  readonly spellRef: string;
  readonly transitionId: string;
  readonly actorId: string;
  readonly rulesRef: string | undefined;
  readonly hpCurrent: number;
  readonly hpMax: number;
  readonly form?: string;
}

export const BONDED_SUMMON_TRIGGERS = [
  'action-temporary-dismissal',
  'action-recall',
  'action-permanent-dismissal',
  'action-dismissal',
  'action-release',
] as const;
export type BondedSummonTrigger = (typeof BONDED_SUMMON_TRIGGERS)[number];

export interface TransitionBondedSummonInput extends EffectMutationContext {
  readonly campaignId: string;
  readonly effectId: string;
  /** The spell record whose action-triggered transition is executed. */
  readonly spellRef: string;
  readonly trigger: BondedSummonTrigger;
  /** Recall into an active combat instance: the side of a creature that has
   *  no combatant in it yet (defaults to its most recent row's side). */
  readonly side?: string;
  readonly faction?: string;
  readonly placement?: string;
}

export interface TransitionBondedSummonResult {
  readonly effect: ActiveEffectView;
  readonly spellRef: string;
  readonly transitionId: string;
  readonly trigger: BondedSummonTrigger;
  readonly actorId: string;
  readonly from: { readonly presence: string; readonly link: 'active' };
  readonly to: { readonly presence: string; readonly link: 'active' | 'none' };
  /** The combatant row that left play, when the creature was in combat. */
  readonly combatantLeft?: string;
  /** The new combatant row a recall created in the active combat instance. */
  readonly combatantEntered?: string;
  /** True when the transition closed the bond and ended the effect. */
  readonly effectEnded: boolean;
  /** The record's placement operation, which the engine does not track: the
   *  model narrates where the creature reappears. */
  readonly narratedPlacement?: {
    readonly kind: string;
    readonly withinFeet?: number;
  };
}

export interface SuppressEffectInput extends EffectMutationContext {
  readonly campaignId: string;
  readonly effectId: string;
  readonly note?: string;
}

export interface ExpireElapsedRoundEffectsInput extends EffectMutationContext {
  readonly campaignId: string;
}

export interface TurnBoundaryEffectInput extends EffectMutationContext {
  readonly campaignId: string;
  readonly combatInstanceId: string;
  readonly roundNumber: number;
  readonly participant: EffectParticipant;
  readonly enteringTurnOrdinal: number;
}

interface TurnBoundaryEffectSummaryBase {
  readonly boundaryParticipant: EffectParticipant;
  readonly enteringTurnOrdinal: number;
}

export type TurnBoundaryEffectSummary =
  | (TurnBoundaryEffectSummaryBase & {
      readonly effectId: string;
      readonly displayName: string;
      readonly cleanup: EffectCleanupSummary;
      readonly boundary: 'round-deadline';
      readonly deadlineRound: number;
    })
  | (TurnBoundaryEffectSummaryBase & {
      readonly effectId: string;
      readonly displayName: string;
      readonly cleanup: EffectCleanupSummary;
      readonly boundary: 'source-turn-start' | 'target-turn-start';
      readonly deadlineTurnOrdinal: number;
    });

export interface ActiveEffectEventView {
  readonly effectId: string;
  readonly seq: number;
  readonly eventKind:
    | 'created'
    | 'refreshed'
    | 'suppressed'
    | 'unsuppressed'
    | 'concentration-check'
    | 'target-removed'
    | 'combat-closed'
    | 'recast'
    | 'presence-transition'
    | 'ended';
  readonly detail: Record<string, unknown>;
  readonly occurredAt: string;
  readonly provenance: string;
  readonly sessionId: string;
}

export class ActiveEffectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ActiveEffectError';
  }
}

/** SRD concentration save DC: max(10, floor(damage/2)) per damage event. */
export function concentrationSaveDc(damage: number): number {
  return Math.max(10, Math.floor(damage / 2));
}

// ---------------------------------------------------------------------------
// Kind profiles: semantic licenses (design doc §2)
// ---------------------------------------------------------------------------

interface EffectKindProfile {
  readonly sourceKinds: readonly EffectSourceKind[];
  readonly linkKinds: readonly EffectLinkKind[];
  /** 'forbidden' rejects any concentration declaration; otherwise
   *  concentration is declared, subject to spell-record derivation. */
  readonly concentration: 'allowed' | 'forbidden';
}

const EFFECT_KIND_PROFILES: Readonly<
  Record<ActiveEffectKind, EffectKindProfile>
> = {
  'spell-effect': {
    sourceKinds: ['spell', 'ruling'],
    linkKinds: ['condition'],
    concentration: 'allowed',
  },
  summoning: {
    sourceKinds: ['spell', 'feature', 'ruling'],
    linkKinds: ['condition', 'actor'],
    concentration: 'allowed',
  },
  ward: {
    sourceKinds: ['spell', 'magic-item', 'ruling'],
    linkKinds: ['condition', 'zone'],
    concentration: 'allowed',
  },
  curse: {
    sourceKinds: ['spell', 'magic-item', 'creature-trait', 'ruling'],
    linkKinds: ['condition'],
    concentration: 'allowed',
  },
  transformation: {
    sourceKinds: ['spell', 'magic-item', 'feature', 'creature-trait', 'ruling'],
    linkKinds: ['condition', 'form'],
    concentration: 'allowed',
  },
  'item-power': {
    sourceKinds: ['magic-item'],
    linkKinds: ['condition'],
    concentration: 'allowed',
  },
  'condition-package': {
    sourceKinds: ['spell', 'creature-trait', 'hazard', 'ruling'],
    linkKinds: ['condition'],
    concentration: 'forbidden',
  },
};

// Zone and form links are created only alongside their canonical projection
// rows; raw active links remain an integrity violation.

// ---------------------------------------------------------------------------
// Spell duration grounding (design doc §2)
// ---------------------------------------------------------------------------

type ParsedSpellDurationForm =
  | { readonly kind: 'instantaneous' }
  | {
      readonly kind: 'timed';
      readonly amount: number;
      readonly unit: EffectDurationUnit;
    }
  | { readonly kind: 'until-dispelled' }
  | { readonly kind: 'until-dispelled-or-triggered' }
  | { readonly kind: 'unparsed' };

interface ParsedSpellDuration {
  readonly concentration: boolean;
  readonly form: ParsedSpellDurationForm;
}

/**
 * Parse the SRD duration prose forms the engine can ground deterministically.
 * Anything else parses to 'unparsed': the declared typed duration stands,
 * but concentration is still derived from the 'Concentration' prefix.
 */
export function parseSpellDurationText(text: string): ParsedSpellDuration {
  const normalized = text.trim().toLowerCase();
  const concentration = normalized.startsWith('concentration');
  let rest = normalized.replace(/^concentration,\s*/, '');
  rest = rest.replace(/^up to\s+/, '');

  if (rest === 'instantaneous') {
    return { concentration, form: { kind: 'instantaneous' } };
  }
  if (rest === 'until dispelled') {
    return { concentration, form: { kind: 'until-dispelled' } };
  }
  if (rest === 'until dispelled or triggered') {
    return { concentration, form: { kind: 'until-dispelled-or-triggered' } };
  }
  const timed = /^(\d+) (round|minute|hour|day)s?$/.exec(rest);
  if (timed !== null) {
    return {
      concentration,
      form: {
        kind: 'timed',
        amount: Number(timed[1]),
        unit: timed[2] as EffectDurationUnit,
      },
    };
  }
  return { concentration, form: { kind: 'unparsed' } };
}

// ---------------------------------------------------------------------------
// Row shapes & codecs
// ---------------------------------------------------------------------------

interface ActiveEffectRow {
  readonly campaign_id: string;
  readonly effect_id: string;
  readonly kind: ActiveEffectKind;
  readonly display_name: string;
  readonly source_kind: EffectSourceKind;
  readonly source_ref: string | null;
  readonly source_actor_kind: EffectParticipantKind | null;
  readonly source_actor_ref: string | null;
  readonly requires_concentration: number;
  readonly concentration_owner_kind: EffectParticipantKind | null;
  readonly concentration_owner_ref: string | null;
  readonly duration_kind: EffectDurationInput['kind'];
  readonly duration_amount: number | null;
  readonly duration_unit: EffectDurationUnit | null;
  readonly anchor_kind: EffectAnchorKind | null;
  readonly anchor_at: string | null;
  readonly anchor_game_time: string | null;
  readonly anchor_elapsed_minutes: number | null;
  readonly deadline_elapsed_minutes: number | null;
  readonly anchor_combat_instance_id: string | null;
  readonly anchor_round: number | null;
  readonly anchor_participant_kind: EffectParticipantKind | null;
  readonly anchor_participant_ref: string | null;
  readonly anchor_participant_turn_ordinal: number | null;
  readonly anchor_trigger: string | null;
  readonly expiry_trigger: string | null;
  readonly dismissible: number;
  readonly status: EffectStatus;
  readonly end_reason: EffectEndReason | null;
  readonly end_detail: string | null;
  readonly ended_at: string | null;
  readonly created_at: string;
}

interface EffectTargetRow {
  readonly target_kind: EffectTargetKind;
  readonly target_ref: string;
  readonly status: 'active' | 'removed';
  readonly removed_reason: string | null;
  readonly removed_at: string | null;
}

interface EffectLinkRow {
  readonly effect_id: string;
  readonly link_kind: EffectLinkKind;
  readonly target_kind: EffectTargetKind;
  readonly target_ref: string;
  readonly projection_ref: string;
  readonly campaign_actor_id: string | null;
  readonly cleanup_on_end: EffectCleanupPolicy;
  readonly cleanup_on_break: EffectCleanupPolicy;
  readonly status: 'active' | 'removed' | 'released';
  readonly removed_reason: string | null;
  readonly removed_at: string | null;
  readonly natural_form_json: string | null;
}

const detailColumn = jsonColumn<Record<string, unknown>>(
  'active_effect_event.detail_json',
);

const EFFECT_COLUMNS = `campaign_id, effect_id, kind, display_name,
  source_kind, source_ref, source_actor_kind, source_actor_ref,
  requires_concentration, concentration_owner_kind, concentration_owner_ref,
  duration_kind, duration_amount, duration_unit, anchor_kind, anchor_at,
  anchor_game_time, anchor_combat_instance_id, anchor_round,
  anchor_elapsed_minutes, deadline_elapsed_minutes,
  anchor_participant_kind, anchor_participant_ref,
  anchor_participant_turn_ordinal, anchor_trigger, expiry_trigger,
  dismissible, status, end_reason, end_detail, ended_at, created_at`;

// ---------------------------------------------------------------------------
// Row -> view (with load-time structural validation)
// ---------------------------------------------------------------------------

/** Global deadline for ordinary round anchors; participant-clock timers have
 * no meaningful global round deadline even though anchor_round records combat
 * provenance. */
function deadlineRound(row: ActiveEffectRow): number | undefined {
  if (
    row.duration_kind !== 'timed' ||
    row.duration_unit !== 'round' ||
    row.anchor_kind === 'source-turn-start' ||
    row.anchor_kind === 'target-turn-start' ||
    row.anchor_round === null ||
    row.duration_amount === null
  ) {
    return undefined;
  }
  return row.anchor_round + row.duration_amount;
}

function elapsedWorldDeadline(
  db: Db,
  duration: ValidatedDuration,
): { anchor: number | null; deadline: number | null } {
  if (duration.kind !== 'timed' || duration.unit === 'round')
    return { anchor: null, deadline: null };
  const row = db
    .prepare('SELECT elapsed_minutes FROM clock WHERE id=1')
    .get() as { elapsed_minutes?: number } | undefined;
  if (row === undefined)
    throw new ActiveEffectError('campaign clock is missing');
  const anchor = row.elapsed_minutes;
  if (!Number.isSafeInteger(anchor) || (anchor as number) < 0)
    throw new ActiveEffectError('campaign clock elapsed_minutes is malformed');
  const safeAnchor = anchor as number;
  const multiplier =
    duration.unit === 'minute' ? 1 : duration.unit === 'hour' ? 60 : 1440;
  const amount = duration.amount;
  if (!Number.isSafeInteger(amount) || (amount as number) < 1)
    throw new ActiveEffectError('elapsed-world duration amount is malformed');
  const delta = (amount as number) * multiplier;
  if (!Number.isSafeInteger(delta) || !Number.isSafeInteger(safeAnchor + delta))
    throw new ActiveEffectError(
      'elapsed-world deadline exceeds safe integer range',
    );
  return {
    anchor: safeAnchor,
    deadline: safeAnchor + delta,
  };
}

function validateElapsedWorldRow(row: ActiveEffectRow): void {
  const world =
    row.duration_kind === 'timed' &&
    (row.duration_unit === 'minute' ||
      row.duration_unit === 'hour' ||
      row.duration_unit === 'day');
  if (world) {
    if (
      row.status === 'ended' &&
      row.anchor_elapsed_minutes === null &&
      row.deadline_elapsed_minutes === null
    )
      return;
    if (
      !Number.isSafeInteger(row.duration_amount) ||
      (row.duration_amount as number) < 1
    )
      throw new ActiveEffectError(
        `active_effect '${row.effect_id}' has malformed elapsed-world duration`,
      );
    if (
      !Number.isSafeInteger(row.anchor_elapsed_minutes) ||
      (row.anchor_elapsed_minutes as number) < 0 ||
      !Number.isSafeInteger(row.deadline_elapsed_minutes) ||
      (row.deadline_elapsed_minutes as number) < 0
    )
      throw new ActiveEffectError(
        `active_effect '${row.effect_id}' has malformed elapsed-world anchor/deadline`,
      );
    const multiplier =
      row.duration_unit === 'minute'
        ? 1
        : row.duration_unit === 'hour'
          ? 60
          : 1440;
    const expected =
      (row.anchor_elapsed_minutes as number) +
      (row.duration_amount as number) * multiplier;
    if (
      !Number.isSafeInteger(expected) ||
      expected !== row.deadline_elapsed_minutes
    )
      throw new ActiveEffectError(
        `active_effect '${row.effect_id}' has inconsistent elapsed-world deadline`,
      );
  } else if (
    row.anchor_elapsed_minutes !== null ||
    row.deadline_elapsed_minutes !== null
  ) {
    throw new ActiveEffectError(
      `active_effect '${row.effect_id}' has elapsed-world evidence on a non-world timer`,
    );
  }
}

function durationView(row: ActiveEffectRow): EffectDurationView {
  return {
    kind: row.duration_kind,
    ...(row.duration_amount === null ? {} : { amount: row.duration_amount }),
    ...(row.duration_unit === null ? {} : { unit: row.duration_unit }),
    ...(row.anchor_kind === null ? {} : { anchorKind: row.anchor_kind }),
    ...(row.anchor_at === null ? {} : { anchorAt: row.anchor_at }),
    ...(row.anchor_game_time === null
      ? {}
      : { anchorGameTime: row.anchor_game_time }),
    ...(row.anchor_combat_instance_id === null
      ? {}
      : { anchorCombatInstanceId: row.anchor_combat_instance_id }),
    ...(row.anchor_round === null ? {} : { anchorRound: row.anchor_round }),
    ...(row.anchor_participant_kind === null ||
    row.anchor_participant_ref === null
      ? {}
      : {
          anchorParticipant: {
            kind: row.anchor_participant_kind,
            ref: row.anchor_participant_ref,
          },
        }),
    ...(row.anchor_participant_turn_ordinal === null
      ? {}
      : { anchorParticipantTurnOrdinal: row.anchor_participant_turn_ordinal }),
    ...(row.anchor_participant_turn_ordinal === null ||
    row.duration_amount === null
      ? {}
      : {
          deadlineParticipantTurnOrdinal:
            row.anchor_participant_turn_ordinal + row.duration_amount,
        }),
    ...(row.anchor_trigger === null
      ? {}
      : { anchorTrigger: row.anchor_trigger }),
    ...(deadlineRound(row) === undefined
      ? {}
      : { deadlineRound: deadlineRound(row) }),
    ...(row.deadline_elapsed_minutes === null
      ? {}
      : { deadlineElapsedMinutes: row.deadline_elapsed_minutes }),
    ...(row.expiry_trigger === null ? {} : { trigger: row.expiry_trigger }),
  };
}

function effectView(
  row: ActiveEffectRow,
  targets: readonly EffectTargetRow[],
  links: readonly EffectLinkRow[],
): ActiveEffectView {
  // Load-time structural validation: durable state a migration or direct
  // write could corrupt fails closed here rather than being interpreted.
  if (
    row.requires_concentration === 1 &&
    (row.concentration_owner_kind === null ||
      row.concentration_owner_ref === null)
  ) {
    throw new ActiveEffectError(
      `active_effect '${row.effect_id}' requires concentration but names no owner`,
    );
  }
  validateElapsedWorldRow(row);
  if (row.status === 'ended') {
    if (row.end_reason === null || row.ended_at === null) {
      throw new ActiveEffectError(
        `active_effect '${row.effect_id}' is ended without end provenance`,
      );
    }
    const activeLink = links.find((link) => link.status === 'active');
    if (activeLink !== undefined) {
      throw new ActiveEffectError(
        `active_effect '${row.effect_id}' is ended but still owns an active ` +
          `${activeLink.link_kind} projection '${activeLink.projection_ref}' — cleanup did not complete`,
      );
    }
    const activeTarget = targets.find((target) => target.status === 'active');
    if (activeTarget !== undefined) {
      throw new ActiveEffectError(
        `active_effect '${row.effect_id}' is ended but still has an active target ` +
          `${activeTarget.target_kind} '${activeTarget.target_ref}' — cleanup did not complete`,
      );
    }
  }
  if (
    row.duration_kind === 'timed' &&
    (row.duration_amount === null ||
      row.duration_unit === null ||
      row.anchor_kind === null ||
      row.anchor_at === null)
  ) {
    throw new ActiveEffectError(
      `active_effect '${row.effect_id}' has a timed duration missing amount/unit/anchor`,
    );
  }
  const turnAnchor = isParticipantTurnAnchor(row.anchor_kind);
  if (turnAnchor) requireParticipantTimerDeadline(row, targets);
  if (
    row.duration_kind === 'timed' &&
    !turnAnchor &&
    (row.anchor_participant_kind !== null ||
      row.anchor_participant_ref !== null ||
      row.anchor_participant_turn_ordinal !== null)
  ) {
    throw new ActiveEffectError(
      `active_effect '${row.effect_id}' has participant evidence on a non-turn anchor`,
    );
  }
  if (
    row.duration_kind === 'timed' &&
    row.anchor_kind === 'trigger-occurred' &&
    (row.anchor_trigger === null || row.anchor_trigger.trim().length === 0)
  ) {
    throw new ActiveEffectError(
      `active_effect '${row.effect_id}' has no trigger evidence`,
    );
  }
  if (
    row.duration_kind === 'timed' &&
    row.anchor_kind !== 'trigger-occurred' &&
    row.anchor_trigger !== null
  ) {
    throw new ActiveEffectError(
      `active_effect '${row.effect_id}' has trigger evidence on a non-trigger anchor`,
    );
  }

  return {
    campaignId: row.campaign_id,
    effectId: row.effect_id,
    kind: row.kind,
    displayName: row.display_name,
    source: {
      kind: row.source_kind,
      ...(row.source_ref === null ? {} : { ref: row.source_ref }),
      ...(row.source_actor_kind === null || row.source_actor_ref === null
        ? {}
        : {
            actor: {
              kind: row.source_actor_kind,
              ref: row.source_actor_ref,
            },
          }),
    },
    requiresConcentration: row.requires_concentration === 1,
    ...(row.concentration_owner_kind === null ||
    row.concentration_owner_ref === null
      ? {}
      : {
          concentrationOwner: {
            kind: row.concentration_owner_kind,
            ref: row.concentration_owner_ref,
          },
        }),
    duration: durationView(row),
    dismissible: row.dismissible === 1,
    status: row.status,
    ...(row.end_reason === null ? {} : { endReason: row.end_reason }),
    ...(row.end_detail === null ? {} : { endDetail: row.end_detail }),
    ...(row.ended_at === null ? {} : { endedAt: row.ended_at }),
    createdAt: row.created_at,
    targets: targets.map((target) => ({
      kind: target.target_kind,
      ref: target.target_ref,
      status: target.status,
      ...(target.removed_reason === null
        ? {}
        : { removedReason: target.removed_reason }),
      ...(target.removed_at === null ? {} : { removedAt: target.removed_at }),
    })),
    links: links.map((link) => ({
      linkKind: link.link_kind,
      target: { kind: link.target_kind, ref: link.target_ref },
      projectionRef: link.projection_ref,
      ...(link.campaign_actor_id === null
        ? {}
        : { campaignActorId: link.campaign_actor_id }),
      cleanupOnEnd: link.cleanup_on_end,
      cleanupOnBreak: link.cleanup_on_break,
      ...(link.natural_form_json === null
        ? {}
        : { naturalForm: JSON.parse(link.natural_form_json) as NaturalForm }),
      status: link.status,
      ...(link.removed_reason === null
        ? {}
        : { removedReason: link.removed_reason }),
      ...(link.removed_at === null ? {} : { removedAt: link.removed_at }),
    })),
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

function readEffectRow(
  db: Db,
  campaignId: string,
  effectId: string,
): ActiveEffectRow | undefined {
  return db
    .prepare(
      `SELECT ${EFFECT_COLUMNS} FROM active_effect
       WHERE campaign_id = ? AND effect_id = ?`,
    )
    .get(campaignId, effectId) as ActiveEffectRow | undefined;
}

function readTargetRows(
  db: Db,
  campaignId: string,
  effectId: string,
): EffectTargetRow[] {
  return db
    .prepare(
      `SELECT target_kind, target_ref, status, removed_reason, removed_at
       FROM active_effect_target
       WHERE campaign_id = ? AND effect_id = ?
       ORDER BY target_kind, target_ref`,
    )
    .all(campaignId, effectId) as EffectTargetRow[];
}

export function isParticipantTurnAnchor(
  anchor: EffectAnchorKind | null,
): anchor is 'source-turn-start' | 'target-turn-start' {
  return anchor === 'source-turn-start' || anchor === 'target-turn-start';
}

export interface ParticipantTimerDeadline {
  readonly boundary: 'source-turn-start' | 'target-turn-start';
  readonly participant: EffectParticipant;
  readonly combatInstanceId: string;
  readonly anchorOrdinal: number;
  readonly deadlineOrdinal: number;
}

/** Validate and derive the one authoritative deadline for a participant-clock
 * timer. Every mutation path uses this instead of interpreting raw columns. */
export function requireParticipantTimerDeadline(
  row: ActiveEffectRow,
  targets: readonly EffectTargetRow[],
): ParticipantTimerDeadline {
  if (!isParticipantTurnAnchor(row.anchor_kind)) {
    throw new ActiveEffectError(
      `active_effect '${row.effect_id}' is not a participant-turn timer`,
    );
  }
  if (
    row.duration_kind !== 'timed' ||
    row.duration_unit !== 'round' ||
    !Number.isInteger(row.duration_amount) ||
    (row.duration_amount as number) < 1
  ) {
    throw new ActiveEffectError(
      `active_effect '${row.effect_id}' participant-turn anchor requires a positive round duration`,
    );
  }
  if (row.anchor_combat_instance_id === null || row.anchor_round === null) {
    throw new ActiveEffectError(
      `active_effect '${row.effect_id}' participant-turn anchor is missing combat provenance`,
    );
  }
  if (
    row.anchor_participant_kind === null ||
    row.anchor_participant_ref === null ||
    row.anchor_participant_ref.trim().length === 0 ||
    !Number.isInteger(row.anchor_participant_turn_ordinal) ||
    (row.anchor_participant_turn_ordinal as number) < 0
  ) {
    throw new ActiveEffectError(
      `active_effect '${row.effect_id}' has incomplete participant-turn clock evidence`,
    );
  }
  const anchorOrdinal = row.anchor_participant_turn_ordinal as number;
  const durationAmount = row.duration_amount as number;
  const participant: EffectParticipant = {
    kind: row.anchor_participant_kind,
    ref: row.anchor_participant_ref,
  };
  if (row.anchor_kind === 'source-turn-start') {
    if (
      row.source_actor_kind === null ||
      row.source_actor_ref === null ||
      row.source_actor_kind !== participant.kind ||
      row.source_actor_ref !== participant.ref
    ) {
      throw new ActiveEffectError(
        `active_effect '${row.effect_id}' has source-turn anchor participant ` +
          `${participant.kind} '${participant.ref}' that does not match source actor ` +
          `${row.source_actor_kind ?? '(missing)'} '${row.source_actor_ref ?? '(missing)'}'`,
      );
    }
  } else if (
    targets.length !== 1 ||
    targets[0]?.target_kind === 'scope' ||
    targets[0]?.target_kind !== participant.kind ||
    targets[0]?.target_ref !== participant.ref
  ) {
    const target =
      targets.length === 1
        ? `${targets[0]?.target_kind ?? '(missing)'} '${targets[0]?.target_ref ?? '(missing)'}'`
        : `${targets.length} targets`;
    throw new ActiveEffectError(
      `active_effect '${row.effect_id}' has target-turn anchor participant ` +
        `${participant.kind} '${participant.ref}' that does not match its sole target ${target}`,
    );
  }
  return {
    boundary: row.anchor_kind,
    participant,
    combatInstanceId: row.anchor_combat_instance_id,
    anchorOrdinal,
    deadlineOrdinal: anchorOrdinal + durationAmount,
  };
}

function readLinkRows(
  db: Db,
  campaignId: string,
  effectId: string,
): EffectLinkRow[] {
  return db
    .prepare(
      `SELECT effect_id, link_kind, target_kind, target_ref, projection_ref,
              campaign_actor_id, cleanup_on_end, cleanup_on_break, status, removed_reason,
              removed_at, natural_form_json
       FROM active_effect_link
       WHERE campaign_id = ? AND effect_id = ?
       ORDER BY link_kind, target_kind, target_ref, projection_ref`,
    )
    .all(campaignId, effectId) as EffectLinkRow[];
}

function requireEffectView(
  db: Db,
  campaignId: string,
  effectId: string,
): ActiveEffectView {
  const row = readEffectRow(db, campaignId, effectId);
  if (row === undefined) {
    throw new ActiveEffectError(`no active effect '${effectId}' exists`);
  }
  return effectView(
    row,
    readTargetRows(db, campaignId, effectId),
    readLinkRows(db, campaignId, effectId),
  );
}

export interface ListActiveEffectsOptions {
  /** Include ended effects (newest first after live ones). */
  readonly includeEnded?: boolean;
}

/**
 * Validated read boundary: every returned view has passed the load-time
 * structural checks in {@link effectView}. Corrupt durable state throws
 * {@link ActiveEffectError} rather than being silently interpreted.
 */
export function listActiveEffects(
  db: Db,
  campaignId: string,
  options: ListActiveEffectsOptions = {},
): ActiveEffectView[] {
  const rows = db
    .prepare(
      `SELECT ${EFFECT_COLUMNS} FROM active_effect
       WHERE campaign_id = ?${
         options.includeEnded === true ? '' : " AND status != 'ended'"
       }
       ORDER BY status = 'ended', created_at, effect_id`,
    )
    .all(campaignId) as ActiveEffectRow[];
  return rows.map((row) =>
    effectView(
      row,
      readTargetRows(db, campaignId, row.effect_id),
      readLinkRows(db, campaignId, row.effect_id),
    ),
  );
}

/** The owner's live (active or suppressed) concentration effect, if any. */
export function getConcentrationEffect(
  db: Db,
  campaignId: string,
  owner: EffectParticipant,
): ActiveEffectView | undefined {
  const row = db
    .prepare(
      `SELECT ${EFFECT_COLUMNS} FROM active_effect
       WHERE campaign_id = ? AND requires_concentration = 1
         AND concentration_owner_kind = ? AND concentration_owner_ref = ?
         AND status IN ('active', 'suppressed')`,
    )
    .get(campaignId, owner.kind, owner.ref) as ActiveEffectRow | undefined;
  if (row === undefined) {
    return undefined;
  }
  return effectView(
    row,
    readTargetRows(db, campaignId, row.effect_id),
    readLinkRows(db, campaignId, row.effect_id),
  );
}

export function listEffectEvents(
  db: Db,
  campaignId: string,
  effectId: string,
): ActiveEffectEventView[] {
  const rows = db
    .prepare(
      `SELECT effect_id, seq, event_kind, detail_json, occurred_at,
              provenance, session_id
       FROM active_effect_event
       WHERE campaign_id = ? AND effect_id = ?
       ORDER BY seq`,
    )
    .all(campaignId, effectId) as {
    effect_id: string;
    seq: number;
    event_kind: ActiveEffectEventView['eventKind'];
    detail_json: string;
    occurred_at: string;
    provenance: string;
    session_id: string;
  }[];
  return rows.map((row) => ({
    effectId: row.effect_id,
    seq: row.seq,
    eventKind: row.event_kind,
    detail: detailColumn.decode(row.detail_json),
    occurredAt: row.occurred_at,
    provenance: row.provenance,
    sessionId: row.session_id,
  }));
}

export interface ActiveEffectIntegrityIssue {
  readonly effectId: string;
  readonly issue: string;
}

/**
 * Full-coverage integrity audit over durable effect state (F3 mutation audit
 * §8). Shares the structural invariant definitions with the strict read
 * boundary ({@link listActiveEffects} via {@link effectView}) and adds the
 * referential/reachability checks the read boundary deliberately leaves to
 * diagnostics: missing or unreachable source actors, concentration owners,
 * targets, and link holders; incapable concentration owners; condition links
 * whose claimed condition entry is absent; unlicensed link kinds; orphan
 * child rows; and event-ledger sequence/terminal violations. Collects every
 * issue rather than stopping at the first.
 */
export function auditActiveEffectIntegrity(
  db: Db,
  campaignId: string,
): ActiveEffectIntegrityIssue[] {
  const issues: ActiveEffectIntegrityIssue[] = [];

  // Orphan child rows: targets/links/events whose owning effect is absent.
  for (const table of [
    'active_effect_target',
    'active_effect_link',
    'active_effect_event',
  ]) {
    const orphans = db
      .prepare(
        `SELECT DISTINCT effect_id FROM ${table}
         WHERE campaign_id = ?
           AND effect_id NOT IN
             (SELECT effect_id FROM active_effect WHERE campaign_id = ?)
         ORDER BY effect_id`,
      )
      .all(campaignId, campaignId) as { effect_id: string }[];
    for (const orphan of orphans) {
      issues.push({
        effectId: orphan.effect_id,
        issue: `orphan ${table} rows exist without an owning active_effect row`,
      });
    }
  }

  const rows = db
    .prepare(
      `SELECT ${EFFECT_COLUMNS} FROM active_effect WHERE campaign_id = ?
       ORDER BY created_at, effect_id`,
    )
    .all(campaignId) as ActiveEffectRow[];
  for (const row of rows) {
    const targets = readTargetRows(db, campaignId, row.effect_id);
    const links = readLinkRows(db, campaignId, row.effect_id);

    // Structural invariants: the exact checks the strict read boundary throws
    // on, evaluated non-fatally here.
    try {
      effectView(row, targets, links);
    } catch (e) {
      issues.push({
        effectId: row.effect_id,
        issue: e instanceof Error ? e.message : String(e),
      });
    }

    if (row.status !== 'ended' && isParticipantTurnAnchor(row.anchor_kind)) {
      try {
        const deadline = requireParticipantTimerDeadline(row, targets);
        const instance = db
          .prepare(
            `SELECT status FROM combat_instance
             WHERE campaign_id = ? AND combat_instance_id = ?`,
          )
          .get(campaignId, deadline.combatInstanceId) as
          | { status: string }
          | undefined;
        if (instance === undefined || instance.status !== 'active') {
          issues.push({
            effectId: row.effect_id,
            issue: `live participant timer is anchored to ${instance === undefined ? 'missing' : instance.status} combat instance '${deadline.combatInstanceId}'`,
          });
        }
        if (!participantRowExists(db, campaignId, deadline.participant)) {
          issues.push({
            effectId: row.effect_id,
            issue: `participant-turn clock references missing ${deadline.participant.kind} '${deadline.participant.ref}'`,
          });
        } else if (deadline.participant.kind === 'combatant') {
          const combatant = db
            .prepare(
              `SELECT combat_instance_id FROM encounter_combatant
               WHERE campaign_id = ? AND combatant_id = ?`,
            )
            .get(campaignId, deadline.participant.ref) as
            | { combat_instance_id: string }
            | undefined;
          if (combatant?.combat_instance_id !== deadline.combatInstanceId) {
            issues.push({
              effectId: row.effect_id,
              issue: `participant-turn clock combatant '${deadline.participant.ref}' belongs to combat instance '${combatant?.combat_instance_id ?? '(missing)'}', not '${deadline.combatInstanceId}'`,
            });
          }
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (
          !issues.some(
            (issue) =>
              issue.effectId === row.effect_id && issue.issue === message,
          )
        ) {
          issues.push({ effectId: row.effect_id, issue: message });
        }
      }
    }

    // Event-ledger invariants: contiguous seq from 1; exactly one terminal
    // event iff the effect ended.
    const events = db
      .prepare(
        `SELECT seq, event_kind FROM active_effect_event
         WHERE campaign_id = ? AND effect_id = ? ORDER BY seq`,
      )
      .all(campaignId, row.effect_id) as { seq: number; event_kind: string }[];
    if (events.some((event, index) => event.seq !== index + 1)) {
      issues.push({
        effectId: row.effect_id,
        issue: `event ledger seq is not contiguous from 1 (got ${events
          .map((event) => event.seq)
          .join(', ')})`,
      });
    }
    const terminalEvents = events.filter(
      (event) => event.event_kind === 'ended',
    ).length;
    const expectedTerminal = row.status === 'ended' ? 1 : 0;
    if (terminalEvents !== expectedTerminal) {
      issues.push({
        effectId: row.effect_id,
        issue: `expected ${expectedTerminal} terminal 'ended' event(s) for status '${row.status}', found ${terminalEvents}`,
      });
    }
    if (
      row.status === 'ended' &&
      events.length > 0 &&
      events.at(-1)?.event_kind !== 'ended'
    ) {
      issues.push({
        effectId: row.effect_id,
        issue: `'ended' must be the final ledger event, but the last event is '${events.at(-1)?.event_kind}'`,
      });
    }

    if (row.status === 'ended') {
      continue;
    }

    // A live round-unit timer must have an evaluable clock: its anchoring
    // combat instance must exist and still be active (closeCombatInstance
    // settles these; only direct writes can corrupt this).
    if (
      row.duration_kind === 'timed' &&
      row.duration_unit === 'round' &&
      row.anchor_combat_instance_id !== null
    ) {
      const anchorInstance = db
        .prepare(
          `SELECT status FROM combat_instance
           WHERE campaign_id = ? AND combat_instance_id = ?`,
        )
        .get(campaignId, row.anchor_combat_instance_id) as
        | { status: string }
        | undefined;
      if (anchorInstance === undefined || anchorInstance.status !== 'active') {
        issues.push({
          effectId: row.effect_id,
          issue: `live round timer is anchored to ${
            anchorInstance === undefined ? 'missing' : anchorInstance.status
          } combat instance '${row.anchor_combat_instance_id}' — its clock can never advance`,
        });
      }
    }

    // Kind license: links must be of kinds the effect's semantic family
    // permits (corruption can only arrive via direct writes).
    const profile = EFFECT_KIND_PROFILES[row.kind];
    for (const link of links) {
      if (
        link.status === 'active' &&
        !profile.linkKinds.includes(link.link_kind)
      ) {
        issues.push({
          effectId: row.effect_id,
          issue: `active '${link.link_kind}' link is not licensed for kind '${row.kind}'`,
        });
      }
    }

    // Source actor: exists and reachable.
    if (row.source_actor_kind !== null && row.source_actor_ref !== null) {
      const sourceActor = {
        kind: row.source_actor_kind,
        ref: row.source_actor_ref,
      };
      if (!participantRowExists(db, campaignId, sourceActor)) {
        issues.push({
          effectId: row.effect_id,
          issue: `source actor references missing ${sourceActor.kind} '${sourceActor.ref}'`,
        });
      } else if (!participantReachable(db, campaignId, sourceActor)) {
        issues.push({
          effectId: row.effect_id,
          issue: `source actor ${sourceActor.kind} '${sourceActor.ref}' is unreachable (closed combat instance)`,
        });
      }
    }

    // Concentration owner: exists, reachable, and capable.
    if (
      row.requires_concentration === 1 &&
      row.concentration_owner_kind !== null &&
      row.concentration_owner_ref !== null
    ) {
      const owner = {
        kind: row.concentration_owner_kind,
        ref: row.concentration_owner_ref,
      };
      if (!participantRowExists(db, campaignId, owner)) {
        issues.push({
          effectId: row.effect_id,
          issue: `concentration owner references missing ${owner.kind} '${owner.ref}'`,
        });
      } else if (!participantReachable(db, campaignId, owner)) {
        issues.push({
          effectId: row.effect_id,
          issue: `concentration owner ${owner.kind} '${owner.ref}' is unreachable (closed combat instance)`,
        });
      } else {
        try {
          requireConcentrationCapableOwner(db, campaignId, owner);
        } catch (e) {
          issues.push({
            effectId: row.effect_id,
            issue: `concentration owner is incapable: ${
              e instanceof Error ? e.message : String(e)
            }`,
          });
        }
      }
    }

    // Active targets: exist and reachable.
    for (const target of targets) {
      if (target.status !== 'active' || target.target_kind === 'scope') {
        continue;
      }
      const participant = {
        kind: target.target_kind as EffectParticipantKind,
        ref: target.target_ref,
      };
      if (!participantRowExists(db, campaignId, participant)) {
        issues.push({
          effectId: row.effect_id,
          issue: `target references missing ${participant.kind} '${participant.ref}'`,
        });
      } else if (!participantReachable(db, campaignId, participant)) {
        issues.push({
          effectId: row.effect_id,
          issue: `target ${participant.kind} '${participant.ref}' is unreachable (closed combat instance)`,
        });
      }
    }

    // Active links: holder exists and is reachable; condition links must
    // find the exact condition entry they claim to own on the holder.
    for (const link of links) {
      if (
        (link.link_kind === 'zone' || link.link_kind === 'form') &&
        (link.cleanup_on_end !== 'remove' || link.cleanup_on_break !== 'remove')
      ) {
        issues.push({
          effectId: row.effect_id,
          issue: `${link.link_kind} link '${link.projection_ref}' has unsupported release cleanup; zone/form links require remove for end and break`,
        });
      }
      if (
        (link.cleanup_on_end === 'revert' ||
          link.cleanup_on_break === 'revert') &&
        parseNaturalForm(link.natural_form_json) === undefined
      ) {
        issues.push({
          effectId: row.effect_id,
          issue: `${link.link_kind} link '${link.projection_ref}' has the 'revert' cleanup policy but no valid natural form to restore`,
        });
      }
      if (link.natural_form_json !== null && link.link_kind !== 'actor') {
        issues.push({
          effectId: row.effect_id,
          issue: `${link.link_kind} link '${link.projection_ref}' records a natural form; only an actor link may`,
        });
      }
      if (link.status !== 'active') {
        continue;
      }
      if (link.link_kind === 'zone') {
        if (link.target_kind !== 'scope') {
          issues.push({
            effectId: row.effect_id,
            issue: `zone link has invalid ${link.target_kind} holder '${link.target_ref}'; zones require scope holders`,
          });
          continue;
        }
        const projection = db
          .prepare(
            'SELECT 1 FROM effect_spatial_zone WHERE campaign_id = ? AND zone_id = ? AND scope_ref = ?',
          )
          .get(campaignId, link.projection_ref, link.target_ref);
        if (projection === undefined)
          issues.push({
            effectId: row.effect_id,
            issue: `zone link claims '${link.projection_ref}' in scope '${link.target_ref}' but no such spatial zone exists`,
          });
        continue;
      }
      if (link.target_kind === 'scope') {
        issues.push({
          effectId: row.effect_id,
          issue: `${link.link_kind} link has invalid scope holder '${link.target_ref}'`,
        });
        continue;
      }
      const holder: EffectParticipant = {
        kind: link.target_kind,
        ref: link.target_ref,
      };
      if (!participantRowExists(db, campaignId, holder)) {
        issues.push({
          effectId: row.effect_id,
          issue: `${link.link_kind} link references missing ${holder.kind} '${holder.ref}'`,
        });
        continue;
      }
      if (!participantReachable(db, campaignId, holder)) {
        issues.push({
          effectId: row.effect_id,
          issue: `${link.link_kind} link holder ${holder.kind} '${holder.ref}' is unreachable (closed combat instance)`,
        });
        continue;
      }
      if (
        link.link_kind === 'condition' &&
        !readParticipantConditionIds(db, campaignId, holder).includes(
          link.projection_ref,
        )
      ) {
        issues.push({
          effectId: row.effect_id,
          issue: `condition link claims '${link.projection_ref}' on ${holder.kind} '${holder.ref}' but no such condition entry exists`,
        });
      }
      if (link.link_kind === 'form') {
        const projection = db
          .prepare(
            'SELECT form_ref FROM effect_transformation_form WHERE campaign_id = ? AND target_kind = ? AND target_ref = ?',
          )
          .get(campaignId, link.target_kind, link.target_ref) as
          | { form_ref: string }
          | undefined;
        if (projection?.form_ref !== link.projection_ref)
          issues.push({
            effectId: row.effect_id,
            issue: `form link claims '${link.projection_ref}' on ${link.target_kind} '${link.target_ref}' but no such form projection exists`,
          });
      }
    }
  }
  const duplicateActorOwners = db
    .prepare(
      `SELECT target_ref, COUNT(*) AS n FROM active_effect_link
     WHERE campaign_id = ? AND link_kind = 'actor' AND target_kind = 'campaign_actor' AND status = 'active'
     GROUP BY target_ref HAVING COUNT(*) > 1 ORDER BY target_ref`,
    )
    .all(campaignId) as { target_ref: string; n: number }[];
  for (const owner of duplicateActorOwners) {
    issues.push({
      effectId: '(campaign-actor)',
      issue: `campaign actor '${owner.target_ref}' is owned by ${owner.n} live effects`,
    });
  }
  // A present 'revert-form' creature must have an active actor link carrying
  // the natural form its reversion restores. A creature migrated from before
  // natural forms were recorded has none: its 0-hit-point reversion refuses.
  const unrecoverableForms = db
    .prepare(
      `SELECT c.combatant_id FROM encounter_combatant c
       JOIN combat_instance i
         ON i.campaign_id = c.campaign_id AND i.combat_instance_id = c.combat_instance_id
       WHERE c.campaign_id = ? AND i.status = 'active'
         AND c.zero_hp_rule = 'revert-form' AND c.status != 'absent'
         AND NOT EXISTS (
           SELECT 1 FROM active_effect_link l
           WHERE l.campaign_id = c.campaign_id AND l.link_kind = 'actor'
             AND l.status = 'active' AND l.natural_form_json IS NOT NULL
             AND ((l.target_kind = 'combatant' AND l.projection_ref = c.combatant_id)
               OR (c.identity_kind = 'campaign_actor'
                   AND (l.campaign_actor_id = c.identity_ref
                     OR (l.target_kind = 'campaign_actor' AND l.target_ref = c.identity_ref)))))
       ORDER BY c.combatant_id`,
    )
    .all(campaignId) as { combatant_id: string }[];
  for (const orphan of unrecoverableForms) {
    issues.push({
      effectId: '(combatant)',
      issue: `combatant '${orphan.combatant_id}' reverts to its natural form at 0 hit points but no active actor link records that natural form`,
    });
  }
  // eshyra-82uk: a pocketed actor exists only as a bonded summon, held by
  // exactly one active actor link of a live, spell-sourced summoning effect.
  const pocketedActors = db
    .prepare(
      `SELECT actor_id FROM campaign_actor
       WHERE campaign_id = ? AND status = 'pocketed' ORDER BY actor_id`,
    )
    .all(campaignId) as { actor_id: string }[];
  for (const pocketed of pocketedActors) {
    const holders = db
      .prepare(
        `SELECT l.effect_id FROM active_effect_link l
         JOIN active_effect e
           ON e.campaign_id = l.campaign_id AND e.effect_id = l.effect_id
         WHERE l.campaign_id = ? AND l.link_kind = 'actor' AND l.status = 'active'
           AND (l.campaign_actor_id = ?
             OR (l.target_kind = 'campaign_actor' AND l.target_ref = ?))
           AND e.status IN ('active', 'suppressed') AND e.kind = 'summoning'
           AND e.source_kind = 'spell'`,
      )
      .all(campaignId, pocketed.actor_id, pocketed.actor_id) as {
      effect_id: string;
    }[];
    if (holders.length !== 1)
      issues.push({
        effectId: holders[0]?.effect_id ?? '(campaign-actor)',
        issue: `campaign actor '${pocketed.actor_id}' is pocketed but is held by ${holders.length} active actor link(s) of live spell-sourced summoning effects; a pocketed actor needs exactly one`,
      });
  }
  const stalePersistentLinks = db
    .prepare(
      `SELECT effect_id, target_ref FROM active_effect_link
     WHERE campaign_id = ? AND link_kind = 'actor' AND target_kind = 'combatant' AND status = 'active' AND campaign_actor_id IS NOT NULL`,
    )
    .all(campaignId) as { effect_id: string; target_ref: string }[];
  for (const link of stalePersistentLinks) {
    issues.push({
      effectId: link.effect_id,
      issue: `persistent actor link still points at combatant '${link.target_ref}'`,
    });
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Shared validation helpers
// ---------------------------------------------------------------------------

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ActiveEffectError(`${label} must be a non-empty string`);
  }
  return value;
}

function requireNonBlankString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ActiveEffectError(`${label} must be a non-empty string`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Participant predicates (2026-07-12 F3 mutation audit §7)
//
// Distinct questions get distinct predicates — row existence alone answers
// none of the others. A combatant is *reachable* only while its combat
// instance is active: `updateCombatant` refuses mutations afterwards, so a
// merely-existing historical row cannot be targeted, own an effect, receive
// projections, or hold concentration. `closeCombatInstance` applies the F3
// closure policy so live effect state never points at unreachable combatants.
// ---------------------------------------------------------------------------

interface CombatantParticipantRow {
  readonly hp_current: number;
  readonly status: string;
  readonly instance_status: string;
}

function readCombatantParticipant(
  db: Db,
  campaignId: string,
  combatantId: string,
): CombatantParticipantRow | undefined {
  return db
    .prepare(
      `SELECT ec.hp_current, ec.status, ci.status AS instance_status
       FROM encounter_combatant ec
       JOIN combat_instance ci
         ON ci.campaign_id = ec.campaign_id
        AND ci.combat_instance_id = ec.combat_instance_id
       WHERE ec.campaign_id = ? AND ec.combatant_id = ?`,
    )
    .get(campaignId, combatantId) as CombatantParticipantRow | undefined;
}

/** Row existence only — the weakest predicate; used by the integrity audit
 *  to distinguish "missing" from "unreachable". */
function participantRowExists(
  db: Db,
  campaignId: string,
  participant: { kind: EffectParticipantKind; ref: string },
): boolean {
  if (participant.kind === 'character') {
    return (
      db
        .prepare('SELECT 1 FROM character WHERE id = ?')
        .get(participant.ref) !== undefined
    );
  }
  if (participant.kind === 'campaign_actor') {
    return (
      db
        .prepare(
          'SELECT 1 FROM campaign_actor WHERE campaign_id = ? AND actor_id = ?',
        )
        .get(campaignId, participant.ref) !== undefined
    );
  }
  return (
    readCombatantParticipant(db, campaignId, participant.ref) !== undefined
  );
}

/** Mechanically reachable: characters always (rows are never deleted in
 *  production); combatants only while their combat instance is active. */
function participantReachable(
  db: Db,
  campaignId: string,
  participant: { kind: EffectParticipantKind; ref: string },
): boolean {
  if (participant.kind === 'character') {
    return participantRowExists(db, campaignId, participant);
  }
  if (participant.kind === 'campaign_actor') {
    return participantRowExists(db, campaignId, participant);
  }
  const row = readCombatantParticipant(db, campaignId, participant.ref);
  return row !== undefined && row.instance_status === 'active';
}

/**
 * Require a participant that can be targeted, own an effect, or receive
 * projected mutations: it must exist AND be reachable. The error
 * distinguishes a missing row from a combatant whose instance closed.
 */
function requireParticipant(
  db: Db,
  campaignId: string,
  participant: EffectParticipant,
  label: string,
): void {
  requireNonEmptyString(participant.ref, `${label} ref`);
  if (
    participant.kind !== 'character' &&
    participant.kind !== 'combatant' &&
    participant.kind !== 'campaign_actor'
  ) {
    throw new ActiveEffectError(
      `${label} kind must be 'character', 'combatant', or 'campaign_actor'`,
    );
  }
  if (participant.kind === 'character') {
    if (!participantRowExists(db, campaignId, participant)) {
      throw new ActiveEffectError(
        `${label} references unknown character '${participant.ref}'`,
      );
    }
    return;
  }
  if (participant.kind === 'campaign_actor') {
    if (!participantRowExists(db, campaignId, participant)) {
      throw new ActiveEffectError(
        `${label} references unknown campaign actor '${participant.ref}'`,
      );
    }
    if (getCampaignActor(db, campaignId, participant.ref)?.status === 'absent')
      throw new ActiveEffectError(
        `${label} references campaign actor '${participant.ref}', which is absent (out of play)`,
      );
    return;
  }
  const row = readCombatantParticipant(db, campaignId, participant.ref);
  if (row === undefined) {
    throw new ActiveEffectError(
      `${label} references unknown combatant '${participant.ref}'`,
    );
  }
  if (row.status === 'absent') {
    throw new ActiveEffectError(
      `${label} references combatant '${participant.ref}', which is absent (out of play)`,
    );
  }
  if (row.instance_status !== 'active') {
    throw new ActiveEffectError(
      `${label} references combatant '${participant.ref}' whose combat instance is ` +
        `${row.instance_status}; a combatant outside an active instance cannot be ` +
        'referenced by new effect state (see the F3 combat-closure policy)',
    );
  }
}

function readGameTime(db: Db): string | undefined {
  const row = db.prepare('SELECT in_game_time FROM clock WHERE id = 1').get() as
    | { in_game_time: string }
    | undefined;
  return row?.in_game_time === '' ? undefined : row?.in_game_time;
}

function readParticipantConditionIds(
  db: Db,
  campaignId: string,
  participant: EffectParticipant,
): string[] {
  if (participant.kind === 'character') {
    const row = db
      .prepare('SELECT conditions_json FROM character WHERE id = ?')
      .get(participant.ref) as { conditions_json: string } | undefined;
    if (row === undefined) {
      return [];
    }
    return (
      JSON.parse(row.conditions_json) as readonly CharacterConditionEntry[]
    ).map((entry) => entry.id);
  }
  if (participant.kind === 'campaign_actor') {
    const row = db
      .prepare(
        'SELECT conditions_json FROM campaign_actor WHERE campaign_id = ? AND actor_id = ?',
      )
      .get(campaignId, participant.ref) as
      | { conditions_json: string }
      | undefined;
    return row === undefined
      ? []
      : (
          JSON.parse(row.conditions_json) as readonly CharacterConditionEntry[]
        ).map((entry) => entry.id);
  }
  const row = db
    .prepare(
      `SELECT conditions_json FROM encounter_combatant
       WHERE campaign_id = ? AND combatant_id = ?`,
    )
    .get(campaignId, participant.ref) as
    | { conditions_json: string }
    | undefined;
  if (row === undefined) {
    return [];
  }
  return (
    JSON.parse(row.conditions_json) as readonly CharacterConditionEntry[]
  ).map((entry) => entry.id);
}

/**
 * Base condition name of a live condition entry id. Effect-projected ids are
 * namespaced (`paralyzed:fx-hold`), so the segment before the first `:`
 * names the condition the entry applies.
 */
function conditionBaseName(conditionId: string): string {
  const base = conditionId.split(':')[0] ?? conditionId;
  return base.trim().toLowerCase();
}

/**
 * True when this condition id incapacitates: it names `incapacitated`
 * itself, or its structured condition record in the campaign rules stack
 * carries an `impliesCondition: incapacitated` mechanic (SRD: paralyzed,
 * petrified, stunned, unconscious). Grounded in the pack's typed relation
 * data — never a hardcoded condition list — so campaign packs that define
 * their own incapacitating conditions are honored automatically. An id with
 * no resolvable condition record does not incapacitate.
 */
export function conditionImpliesIncapacitated(
  db: Db,
  conditionId: string,
  resolver?: CampaignRulesPackResolver,
): boolean {
  const base = conditionBaseName(conditionId);
  if (base === 'incapacitated') {
    return true;
  }
  const record = lookupCampaignRecord(
    db,
    'condition',
    `condition:${base}`,
    resolver,
  );
  if (record === undefined) {
    return false;
  }
  const mechanics = (
    record.data as {
      mechanics?: { effects?: readonly Record<string, unknown>[] };
    }
  ).mechanics?.effects;
  if (!Array.isArray(mechanics)) {
    return false;
  }
  return mechanics.some(
    (effect) =>
      effect.kind === 'impliesCondition' &&
      effect.condition === 'incapacitated',
  );
}

/** True when any of these live condition entry ids incapacitates. */
export function anyConditionImpliesIncapacitated(
  db: Db,
  conditionIds: readonly string[],
  resolver?: CampaignRulesPackResolver,
): boolean {
  return conditionIds.some((id) =>
    conditionImpliesIncapacitated(db, id, resolver),
  );
}

/**
 * Concentration requires a capable owner: an incapacitated or dead creature
 * cannot start concentrating (SRD concentration). Incapacitation is checked
 * three ways — character life state (F6), combatant HP/status, and any
 * carried condition whose structured record implies `incapacitated`. This
 * must be checked at creation because the cleanup hooks fire only on
 * *transitions* (alive → non-alive, up → down, capable → incapacitated) —
 * admitting an already-down owner here would create a live concentration
 * effect nothing ever cleans up.
 */
function requireConcentrationCapableOwner(
  db: Db,
  campaignId: string,
  owner: EffectParticipant,
  resolver?: CampaignRulesPackResolver,
): void {
  if (owner.kind === 'campaign_actor') {
    throw new ActiveEffectError(
      'campaign actors cannot own concentration; use a character or combatant',
    );
  }
  if (owner.kind === 'character') {
    const row = db
      .prepare('SELECT life_state FROM character WHERE id = ?')
      .get(owner.ref) as { life_state: string } | undefined;
    if (row !== undefined && row.life_state !== 'alive') {
      throw new ActiveEffectError(
        `character '${owner.ref}' is ${row.life_state} and cannot concentrate ` +
          '(concentration requires a capable, conscious owner)',
      );
    }
  } else {
    const row = db
      .prepare(
        `SELECT hp_current, status FROM encounter_combatant
         WHERE campaign_id = ? AND combatant_id = ?`,
      )
      .get(campaignId, owner.ref) as
      | { hp_current: number; status: string }
      | undefined;
    if (
      row !== undefined &&
      (row.hp_current === 0 ||
        row.status === 'dead' ||
        row.status === 'unconscious' ||
        row.status === 'inactive' ||
        row.status === 'absent')
    ) {
      // 'inactive' means removed from active play (audit §7); 'escaped' is
      // documented as still capable while the instance stays active.
      throw new ActiveEffectError(
        `combatant '${owner.ref}' is ${
          row.hp_current === 0 && row.status !== 'dead' ? '0 HP' : row.status
        } and cannot concentrate`,
      );
    }
  }
  const incapacitating = readParticipantConditionIds(
    db,
    campaignId,
    owner,
  ).find((id) => conditionImpliesIncapacitated(db, id, resolver));
  if (incapacitating !== undefined) {
    throw new ActiveEffectError(
      `${owner.kind} '${owner.ref}' carries the incapacitating condition ` +
        `'${incapacitating}' and cannot concentrate`,
    );
  }
}

function nextEventSeq(db: Db, campaignId: string, effectId: string): number {
  const row = db
    .prepare(
      `SELECT COALESCE(MAX(seq), 0) AS max_seq FROM active_effect_event
       WHERE campaign_id = ? AND effect_id = ?`,
    )
    .get(campaignId, effectId) as { max_seq: number };
  return row.max_seq + 1;
}

function appendEvent(
  db: Db,
  campaignId: string,
  effectId: string,
  eventKind: ActiveEffectEventView['eventKind'],
  detail: Record<string, unknown>,
  ctx: EffectMutationContext,
): void {
  // Ledger invariants: 'ended' is the FINAL event and there is exactly one.
  // finalizeEnd flips status before appending its own 'ended' event, so the
  // non-terminal guard blocks any transition event a re-entrant caller might
  // try to append after a terminal cascade without blocking the terminal
  // event itself — and the terminal guard makes a SECOND 'ended' event
  // impossible even if a future caller reaches this seam with stale state.
  if (eventKind !== 'ended') {
    const status = db
      .prepare(
        `SELECT status FROM active_effect
         WHERE campaign_id = ? AND effect_id = ?`,
      )
      .get(campaignId, effectId) as { status: EffectStatus } | undefined;
    if (status?.status === 'ended') {
      throw new ActiveEffectError(
        `cannot append '${eventKind}' event to ended effect '${effectId}': ` +
          "'ended' is the final ledger event",
      );
    }
  } else {
    const existingTerminal = db
      .prepare(
        `SELECT 1 FROM active_effect_event
         WHERE campaign_id = ? AND effect_id = ? AND event_kind = 'ended'`,
      )
      .get(campaignId, effectId);
    if (existingTerminal !== undefined) {
      throw new ActiveEffectError(
        `effect '${effectId}' already has its terminal 'ended' event; a second ` +
          'terminal event is never appended',
      );
    }
  }
  db.prepare(
    `INSERT INTO active_effect_event(
       campaign_id, effect_id, seq, event_kind, detail_json, occurred_at,
       provenance, session_id
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    campaignId,
    effectId,
    nextEventSeq(db, campaignId, effectId),
    eventKind,
    detailColumn.encode(detail),
    ctx.at,
    ctx.provenance,
    ctx.sessionId,
  );
}

interface ValidatedDuration {
  readonly kind: EffectDurationInput['kind'];
  readonly amount: number | null;
  readonly unit: EffectDurationUnit | null;
  readonly anchorKind: EffectAnchorKind | null;
  readonly anchorAt: string | null;
  readonly anchorGameTime: string | null;
  readonly anchorCombatInstanceId: string | null;
  readonly anchorRound: number | null;
  readonly anchorParticipantKind: EffectParticipantKind | null;
  readonly anchorParticipantRef: string | null;
  readonly anchorParticipantTurnOrdinal: number | null;
  readonly anchorTrigger: string | null;
  readonly expiryTrigger: string | null;
}

/**
 * Validate a duration declaration and stamp its anchor facts. Round-unit
 * timers require an active combat instance — outside structured combat a
 * round timer has neither a deadline nor an advancing clock, which is one of
 * the impossible states this module rejects.
 *
 * Anchor semantics are validated, not just enum membership: `spell-cast`
 * requires a spell source (it is meaningless otherwise), `effect-created` is
 * always available. Turn-relative anchors use the participant-local F2 clock;
 * trigger-occurrence anchors retain explicit semantic evidence.
 */
function validateDuration(
  db: Db,
  campaignId: string,
  duration: EffectDurationInput,
  dismissible: boolean,
  sourceKind: EffectSourceKind,
  ctx: EffectMutationContext,
  sourceActor?: EffectParticipant,
  effectTargets: readonly EffectTargetInput[] = [],
): ValidatedDuration {
  const empty: Omit<ValidatedDuration, 'kind'> = {
    amount: null,
    unit: null,
    anchorKind: null,
    anchorAt: null,
    anchorGameTime: null,
    anchorCombatInstanceId: null,
    anchorRound: null,
    anchorParticipantKind: null,
    anchorParticipantRef: null,
    anchorParticipantTurnOrdinal: null,
    anchorTrigger: null,
    expiryTrigger: null,
  };
  switch (duration.kind) {
    case 'timed': {
      if (!Number.isInteger(duration.amount) || duration.amount < 1) {
        throw new ActiveEffectError(
          'timed duration amount must be a positive integer',
        );
      }
      if (!EFFECT_DURATION_UNITS.includes(duration.unit)) {
        throw new ActiveEffectError(
          `timed duration unit must be one of: ${EFFECT_DURATION_UNITS.join(', ')}`,
        );
      }
      if (!EFFECT_ANCHOR_KINDS.includes(duration.anchor)) {
        throw new ActiveEffectError(
          `duration anchor must be one of: ${EFFECT_ANCHOR_KINDS.join(', ')}`,
        );
      }
      if (
        duration.anchor !== 'trigger-occurred' &&
        duration.anchorTrigger !== undefined
      ) {
        throw new ActiveEffectError(
          `anchorTrigger is only valid for 'trigger-occurred' durations`,
        );
      }
      if (duration.anchor === 'spell-cast' && sourceKind !== 'spell') {
        throw new ActiveEffectError(
          `anchor 'spell-cast' requires a spell source (got '${sourceKind}'); ` +
            "use 'effect-created'",
        );
      }
      let instanceId: string | null = null;
      let round: number | null = null;
      let anchorParticipant: EffectParticipant | undefined;
      if (duration.anchor === 'source-turn-start') {
        if (sourceActor === undefined) {
          throw new ActiveEffectError(
            "anchor 'source-turn-start' requires source.actor",
          );
        }
        anchorParticipant = sourceActor;
        if (duration.unit !== 'round') {
          throw new ActiveEffectError(
            "anchor 'source-turn-start' requires unit 'round'",
          );
        }
      } else if (duration.anchor === 'target-turn-start') {
        const targets = effectTargets;
        if (targets.length !== 1 || targets[0]?.kind === 'scope') {
          throw new ActiveEffectError(
            "anchor 'target-turn-start' requires exactly one character or combatant target",
          );
        }
        anchorParticipant = targets[0] as EffectParticipant;
        if (duration.unit !== 'round') {
          throw new ActiveEffectError(
            "anchor 'target-turn-start' requires unit 'round'",
          );
        }
      }
      if (anchorParticipant !== undefined) {
        if (anchorParticipant.kind === 'campaign_actor') {
          throw new ActiveEffectError(
            'campaign actors cannot anchor participant-turn timers; use a character or combatant',
          );
        }
        requireParticipant(
          db,
          campaignId,
          anchorParticipant,
          'anchor participant',
        );
      }
      const anchorTrigger =
        duration.anchor === 'trigger-occurred'
          ? requireNonBlankString(
              duration.anchorTrigger,
              "anchor 'trigger-occurred' requires a non-empty anchorTrigger",
            )
          : null;
      if (duration.unit === 'round') {
        const instance = getActiveCombatInstance(db, campaignId);
        if (instance === undefined) {
          throw new ActiveEffectError(
            'a round-unit duration requires an active combat instance to anchor to; ' +
              'outside combat use minute/hour/day or a named trigger',
          );
        }
        const turn = db
          .prepare(
            `SELECT round_number FROM combat_instance
             WHERE campaign_id = ? AND combat_instance_id = ?`,
          )
          .get(campaignId, instance.combatInstanceId) as {
          round_number: number;
        };
        instanceId = instance.combatInstanceId;
        round = Math.max(1, turn.round_number);
      }
      const participantOrdinal =
        anchorParticipant === undefined || instanceId === null
          ? null
          : readAnchorTurnOrdinal(
              db,
              campaignId,
              instanceId,
              anchorParticipant as {
                kind: 'character' | 'combatant';
                ref: string;
              },
            );
      return {
        kind: 'timed',
        amount: duration.amount,
        unit: duration.unit,
        anchorKind: duration.anchor,
        anchorAt: ctx.at,
        anchorGameTime: readGameTime(db) ?? null,
        anchorCombatInstanceId: instanceId,
        anchorRound: round,
        anchorParticipantKind: anchorParticipant?.kind ?? null,
        anchorParticipantRef: anchorParticipant?.ref ?? null,
        anchorParticipantTurnOrdinal: participantOrdinal,
        anchorTrigger,
        expiryTrigger: null,
      };
    }
    case 'until-dismissed':
      if (!dismissible) {
        throw new ActiveEffectError(
          "an 'until-dismissed' effect must be dismissible",
        );
      }
      return { kind: 'until-dismissed', ...empty };
    case 'until-removed':
      return { kind: 'until-removed', ...empty };
    case 'until-trigger':
      return {
        kind: 'until-trigger',
        ...empty,
        expiryTrigger: requireNonEmptyString(
          duration.trigger,
          "an 'until-trigger' duration's trigger",
        ),
      };
    default:
      throw new ActiveEffectError(
        `unsupported duration kind: ${(duration as { kind: string }).kind}`,
      );
  }
}

function durationInputForAudit(
  validated: ValidatedDuration,
): Record<string, unknown> {
  return {
    kind: validated.kind,
    ...(validated.amount === null ? {} : { amount: validated.amount }),
    ...(validated.unit === null ? {} : { unit: validated.unit }),
    ...(validated.anchorKind === null
      ? {}
      : { anchorKind: validated.anchorKind }),
    ...(validated.anchorAt === null ? {} : { anchorAt: validated.anchorAt }),
    ...(validated.anchorGameTime === null
      ? {}
      : { anchorGameTime: validated.anchorGameTime }),
    ...(validated.anchorCombatInstanceId === null
      ? {}
      : { anchorCombatInstanceId: validated.anchorCombatInstanceId }),
    ...(validated.anchorRound === null
      ? {}
      : { anchorRound: validated.anchorRound }),
    ...(validated.anchorParticipantKind === null ||
    validated.anchorParticipantRef === null
      ? {}
      : {
          anchorParticipant: {
            kind: validated.anchorParticipantKind,
            ref: validated.anchorParticipantRef,
          },
        }),
    ...(validated.anchorParticipantTurnOrdinal === null
      ? {}
      : {
          anchorParticipantTurnOrdinal: validated.anchorParticipantTurnOrdinal,
        }),
    ...(validated.anchorTrigger === null
      ? {}
      : { anchorTrigger: validated.anchorTrigger }),
    ...(validated.expiryTrigger === null
      ? {}
      : { trigger: validated.expiryTrigger }),
  };
}

// ---------------------------------------------------------------------------
// Cleanup (shared by every end path)
// ---------------------------------------------------------------------------

/**
 * Remove or release every active link the effect owns, per its typed cleanup
 * policy for this end mode, and mark remaining active targets removed.
 * Runs inside the caller's transaction; returns the audit summary.
 *
 * A projection whose holder is unreachable (deleted character, combatant of a
 * closed instance) is recorded as 'missing': the link record is closed so the
 * effect cannot end with dangling ownership, and the audit trail shows the
 * projection was not deleted by this cleanup.
 */
function cleanupOwnedState(
  db: Db,
  campaignId: string,
  effectId: string,
  mode: 'end' | 'break',
  reasonLabel: string,
  ctx: EffectMutationContext,
): EffectCleanupSummary {
  const links = readLinkRows(db, campaignId, effectId).filter(
    (link) => link.status === 'active',
  );
  const actions: EffectCleanupAction[] = [];
  for (const link of links) {
    const policy =
      mode === 'break' ? link.cleanup_on_break : link.cleanup_on_end;
    const action = applyLinkPolicy(db, campaignId, link, policy, ctx);
    db.prepare(
      `UPDATE active_effect_link
       SET status = ?, removed_reason = ?, removed_at = ?,
           provenance = ?, session_id = ?, updated_at = ?
       WHERE campaign_id = ? AND effect_id = ? AND link_kind = ?
         AND target_kind = ? AND target_ref = ? AND projection_ref = ?`,
    ).run(
      action === 'released' ? 'released' : 'removed',
      reasonLabel,
      ctx.at,
      ctx.provenance,
      ctx.sessionId,
      ctx.at,
      campaignId,
      effectId,
      link.link_kind,
      link.target_kind,
      link.target_ref,
      link.projection_ref,
    );
    actions.push({
      linkKind: link.link_kind,
      target: { kind: link.target_kind, ref: link.target_ref },
      projectionRef: link.projection_ref,
      action,
    });
  }

  const targetsRemoved = db
    .prepare(
      `UPDATE active_effect_target
       SET status = 'removed', removed_reason = 'effect-ended',
           removed_at = ?, provenance = ?, session_id = ?, updated_at = ?
       WHERE campaign_id = ? AND effect_id = ? AND status = 'active'`,
    )
    .run(
      ctx.at,
      ctx.provenance,
      ctx.sessionId,
      ctx.at,
      campaignId,
      effectId,
    ).changes;

  return { links: actions, targetsRemoved };
}

/** Apply one stored cleanup policy to an owned projection. */
function applyLinkPolicy(
  db: Db,
  campaignId: string,
  link: EffectLinkRow,
  policy: EffectCleanupPolicy,
  ctx: EffectMutationContext,
): EffectCleanupAction['action'] {
  if (policy !== 'revert') refuseLegacyFormReversion(db, campaignId, link);
  // A creature dismissed to its pocket dimension never outlives its bond:
  // whatever the stored policy, ending the bond takes it out of play
  // (absent), never leaving an unbonded pocketed actor (eshyra-82uk).
  if (policy !== 'revert' && holdsPocketedActor(db, campaignId, link))
    return removeProjection(db, campaignId, link, ctx);
  if (policy === 'release') return 'released';
  if (policy === 'revert') return revertProjection(db, campaignId, link, ctx);
  return removeProjection(db, campaignId, link, ctx);
}

/** True when the actor link's holder is a campaign actor in its pocket dimension. */
function holdsPocketedActor(
  db: Db,
  campaignId: string,
  link: EffectLinkRow,
): boolean {
  if (link.link_kind !== 'actor') return false;
  const actorId =
    link.campaign_actor_id ??
    (link.target_kind === 'campaign_actor' ? link.target_ref : null);
  if (actorId === null) return false;
  return (
    (
      db
        .prepare(
          'SELECT status FROM campaign_actor WHERE campaign_id = ? AND actor_id = ?',
        )
        .get(campaignId, actorId) as { status: string } | undefined
    )?.status === 'pocketed'
  );
}

/** A live creature whose 0-hit-point rule is 'revert-form' returns to its
 *  natural form when its transformation ends; only a 'revert' link records
 *  that form. A link migrated from before natural forms were recorded (0040)
 *  still carries the old remove/release policy and no snapshot: applying it
 *  would make the creature absent (or leave it transformed), so refuse
 *  instead of translating it. */
function refuseLegacyFormReversion(
  db: Db,
  campaignId: string,
  link: EffectLinkRow,
): void {
  if (link.link_kind !== 'actor') return;
  const holder =
    link.target_kind === 'campaign_actor'
      ? (db
          .prepare(
            `SELECT status, json_extract(state_json, '$.combatLifecycle.zeroHpRule') AS rule
             FROM campaign_actor WHERE campaign_id = ? AND actor_id = ?`,
          )
          .get(campaignId, link.target_ref) as
          | { status: string; rule: string | null }
          | undefined)
      : (db
          .prepare(
            `SELECT status, zero_hp_rule AS rule FROM encounter_combatant
             WHERE campaign_id = ? AND combatant_id = ?`,
          )
          .get(campaignId, link.projection_ref) as
          | { status: string; rule: string | null }
          | undefined);
  if (
    holder === undefined ||
    holder.rule !== 'revert-form' ||
    holder.status === 'dead' ||
    holder.status === 'absent'
  )
    return;
  throw new ActiveEffectError(
    `'${link.projection_ref}' returns to its natural form when its transformation ends, but its link was recorded before natural forms were (it has no snapshot to restore); ` +
      'its stored cleanup would take it out of play instead, so this cleanup is refused. The engine cannot recover that natural form (state from a development build before migration 0040)',
  );
}

function parseNaturalForm(json: string | null): NaturalForm | undefined {
  if (json === null) return undefined;
  try {
    const parsed: unknown = JSON.parse(json);
    if (isNaturalForm(parsed)) return parsed;
  } catch {
    // fall through to undefined
  }
  return undefined;
}

function isNaturalForm(value: unknown): value is NaturalForm {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return false;
  const v = value as Record<string, unknown>;
  return (
    Number.isInteger(v.hpCurrent) &&
    (v.hpCurrent as number) > 0 &&
    Number.isInteger(v.hpMax) &&
    (v.hpMax as number) >= (v.hpCurrent as number) &&
    typeof v.rulesRef === 'string' &&
    v.rulesRef.length > 0
  );
}

/** Restore an owned creature's recorded natural form (the 'revert' cleanup):
 *  it stays in play. 'missing' when the holder is unreachable, or is dead or
 *  already gone. */
function revertProjection(
  db: Db,
  campaignId: string,
  link: EffectLinkRow,
  ctx: EffectMutationContext,
): 'reverted' | 'missing' {
  const naturalForm = parseNaturalForm(link.natural_form_json);
  if (link.link_kind !== 'actor' || naturalForm === undefined)
    throw new ActiveEffectError(
      `link '${link.projection_ref}' has the 'revert' cleanup policy but no recorded natural form; its stored state is inconsistent`,
    );
  if (link.target_kind === 'campaign_actor')
    return revertCampaignActorToNaturalForm(db, {
      campaignId,
      actorId: link.target_ref,
      naturalForm,
      ...ctx,
    });
  return revertCombatantToNaturalForm(db, {
    campaignId,
    combatantId: link.projection_ref,
    naturalForm,
    ...ctx,
  });
}

/** The natural form recorded on the active actor link held by this combatant
 *  or its durable actor, with the owning effect. */
export function findActiveNaturalForm(
  db: Db,
  campaignId: string,
  holder: { combatantId?: string; actorId?: string },
): { effectId: string; naturalForm: NaturalForm | undefined } | undefined {
  const match = activeActorLinkMatcher(holder);
  const effectIds = db
    .prepare(
      `SELECT DISTINCT effect_id FROM active_effect_link
       WHERE campaign_id = ? AND link_kind = 'actor' AND status = 'active'
       ORDER BY effect_id`,
    )
    .all(campaignId) as { effect_id: string }[];
  for (const { effect_id } of effectIds) {
    const link = readLinkRows(db, campaignId, effect_id).find(
      (candidate) =>
        candidate.link_kind === 'actor' &&
        candidate.status === 'active' &&
        match(candidate),
    );
    if (link !== undefined)
      return {
        effectId: effect_id,
        naturalForm: parseNaturalForm(link.natural_form_json),
      };
  }
  return undefined;
}

/** Delete one owned projection from its holder through the canonical seams. */
function removeProjection(
  db: Db,
  campaignId: string,
  link: EffectLinkRow,
  ctx: EffectMutationContext,
): 'removed' | 'missing' {
  if (link.link_kind === 'condition') {
    if (link.target_kind === 'character') {
      try {
        const result = removeCondition(db, link.projection_ref, {
          ...ctx,
          characterId: link.target_ref,
        });
        return result.removed ? 'removed' : 'missing';
      } catch (e) {
        if (e instanceof MutateStateError) {
          return 'missing';
        }
        throw e;
      }
    }
    if (link.target_kind === 'campaign_actor') {
      try {
        const result = updateCampaignActor(db, {
          campaignId,
          actorId: link.target_ref,
          removeCondition: link.projection_ref,
          ...ctx,
        });
        return result.conditions.every(
          (condition) => condition.id !== link.projection_ref,
        )
          ? 'removed'
          : 'missing';
      } catch (e) {
        if (e instanceof EncounterCombatantError) return 'missing';
        throw e;
      }
    }
    try {
      const result = updateCombatant(db, {
        campaignId,
        combatantId: link.target_ref,
        removeCondition: link.projection_ref,
        ...ctx,
      });
      return result.conditionRemoved ? 'removed' : 'missing';
    } catch (e) {
      if (e instanceof EncounterCombatantError) {
        return 'missing';
      }
      throw e;
    }
  }
  if (link.link_kind === 'actor') {
    // F3 remove takes an owned creature out of play through the engine seam
    // (status absent): 'removed' unless the holder is truly unreachable.
    // A dying or stable creature is unreachable by the start_effect and
    // update_combatant guards; the seam raises an invariant error for it,
    // which propagates rather than being translated into another action.
    if (link.target_kind === 'campaign_actor')
      return removeCampaignActorFromPlay(db, {
        campaignId,
        actorId: link.target_ref,
        ...ctx,
      });
    return removeCombatantFromPlay(db, {
      campaignId,
      combatantId: link.projection_ref,
      ...ctx,
    });
  }
  if (link.link_kind === 'zone') {
    return db
      .prepare(
        'DELETE FROM effect_spatial_zone WHERE campaign_id = ? AND zone_id = ? AND scope_ref = ?',
      )
      .run(campaignId, link.projection_ref, link.target_ref).changes === 1
      ? 'removed'
      : 'missing';
  }
  return db
    .prepare(
      'DELETE FROM effect_transformation_form WHERE campaign_id = ? AND target_kind = ? AND target_ref = ? AND form_ref = ?',
    )
    .run(campaignId, link.target_kind, link.target_ref, link.projection_ref)
    .changes === 1
    ? 'removed'
    : 'missing';
}

interface FinalizeEndInput {
  readonly reason: EffectEndReason;
  readonly detail?: string;
  readonly note?: string;
  readonly trigger?: string;
}

interface FinalizeEndOutcome {
  /** True iff THIS call performed the terminal transition. False when the
   *  durable row was already ended — typically by a nested cascade from an
   *  earlier iteration of the caller's snapshot loop — in which case the
   *  first winning reason/detail/provenance/cleanup/event are untouched. */
  readonly performed: boolean;
  readonly cleanup: EffectCleanupSummary;
}

/**
 * Shared terminal transition: status claim + cleanup + 'ended' event.
 *
 * Terminal authority comes from the DURABLE row, never the caller's snapshot
 * (F3 mutation audit, invariant 20): the status flip is a conditional UPDATE
 * that only succeeds while the effect is still live, so a stale snapshot row
 * can never terminalize twice, overwrite the winning end reason, re-run
 * cleanup, or append a second 'ended' event — callers learn they lost via
 * `performed: false` and must not report the transition as theirs.
 *
 * The claim happens FIRST, cleanup second (invariant 12): cleanup can
 * cascade — removing an owned actor takes it out of play (absent), which breaks that
 * actor's own concentration, whose cleanup can cascade further. Every nested
 * break re-derives liveness from the durable row, so re-entry onto this
 * effect is a no-op: no double-end, no duplicate terminal event, no infinite
 * recursion, no dependence on iteration order. The transient
 * ended-with-active-links state is invisible outside the transaction.
 */
function finalizeEnd(
  db: Db,
  row: ActiveEffectRow,
  input: FinalizeEndInput,
  ctx: EffectMutationContext,
): FinalizeEndOutcome {
  const mode = input.reason === 'concentration-broken' ? 'break' : 'end';
  const reasonLabel =
    input.detail === undefined
      ? input.reason
      : `${input.reason}:${input.detail}`;
  const claim = db
    .prepare(
      `UPDATE active_effect
       SET status = 'ended', end_reason = ?, end_detail = ?, ended_at = ?,
           provenance = ?, session_id = ?, updated_at = ?
       WHERE campaign_id = ? AND effect_id = ?
         AND status IN ('active', 'suppressed')`,
    )
    .run(
      input.reason,
      input.detail ?? null,
      ctx.at,
      ctx.provenance,
      ctx.sessionId,
      ctx.at,
      row.campaign_id,
      row.effect_id,
    );
  if (claim.changes === 0) {
    return { performed: false, cleanup: { links: [], targetsRemoved: 0 } };
  }
  const priorTargets =
    mode === 'break' ? readTargetRows(db, row.campaign_id, row.effect_id) : [];
  const baseCleanup = cleanupOwnedState(
    db,
    row.campaign_id,
    row.effect_id,
    mode,
    reasonLabel,
    ctx,
  );
  const successorEffectId =
    mode === 'break'
      ? createUncontrolledSuccessor(db, row, priorTargets, reasonLabel, ctx)
      : undefined;
  const cleanup: EffectCleanupSummary =
    successorEffectId === undefined
      ? baseCleanup
      : { ...baseCleanup, successorEffectId };
  appendEvent(
    db,
    row.campaign_id,
    row.effect_id,
    'ended',
    {
      reason: input.reason,
      ...(input.detail === undefined ? {} : { detail: input.detail }),
      ...(input.note === undefined ? {} : { note: input.note }),
      ...(input.trigger === undefined ? {} : { trigger: input.trigger }),
      ...(successorEffectId === undefined ? {} : { successorEffectId }),
      cleanup: {
        links: cleanup.links.map((action) => ({
          linkKind: action.linkKind,
          targetKind: action.target.kind,
          targetRef: action.target.ref,
          projectionRef: action.projectionRef,
          action: action.action,
        })),
        targetsRemoved: cleanup.targetsRemoved,
      },
    },
    ctx,
  );
  return { performed: true, cleanup };
}

/** The record transition that removes an uncontrolled summoned creature at an
 *  absolute time after casting (Conjure Elemental, Conjure Fey): trigger
 *  'absolute-time-reached' that removes presence, applying only when the
 *  creature is 'uncontrolled', with a cast-anchored timer. Derived from the
 *  record's transitions, never from spell names. */
/** Anchors that mark the moment a creature was summoned: the record's
 *  'spell-cast' anchor, or the effect's own creation, which happens at that
 *  casting. createActiveEffect admits only these for a cast-anchored removal,
 *  so the successor created at a concentration break can always copy the
 *  deadline. */
/** Effect-id suffix reserved for the engine-created uncontrolled successor. */
const UNCONTROLLED_SUCCESSOR_SUFFIX = ':uncontrolled';

function uncontrolledSuccessorId(effectId: string): string {
  return `${effectId}${UNCONTROLLED_SUCCESSOR_SUFFIX}`;
}

const SUMMONING_MOMENT_ANCHORS: readonly string[] = [
  'spell-cast',
  'effect-created',
];

function deriveUncontrolledRemoval(
  record: RulesRecord,
): { id: string; amount: number; unit: string; anchor: string } | undefined {
  for (const t of recordTransitions(record)) {
    if (
      t.effectKind === 'summoning' &&
      t.trigger === 'absolute-time-reached' &&
      changesTo(t, 'presence', 'absent') &&
      t.whenControl.length === 1 &&
      t.whenControl[0] === 'uncontrolled' &&
      t.timer !== undefined
    )
      return { id: t.id, ...t.timer };
  }
  return undefined;
}

/**
 * A broken concentration released an owned creature whose spell record says
 * that, once uncontrolled, it disappears a fixed time after the spell was
 * cast. The terminal end of the concentration effect is unchanged; in the same
 * transaction the released creatures move to one successor effect
 * `<id>:uncontrolled`: no concentration, not dismissible ("An uncontrolled
 * elemental can't be dismissed by you"), the original cast anchor and
 * deadline copied verbatim (the removal is anchored to the casting, never to
 * the break), and 'remove' cleanup so the ordinary world-time expiry takes the
 * creature out of play. Returns the successor id, or undefined when the spell
 * has no such transition or no creature was released.
 */
function createUncontrolledSuccessor(
  db: Db,
  snapshot: ActiveEffectRow,
  priorTargets: readonly EffectTargetRow[],
  reasonLabel: string,
  ctx: EffectMutationContext,
): string | undefined {
  // Anchor evidence comes from the durable row, never the caller's snapshot.
  const original =
    readEffectRow(db, snapshot.campaign_id, snapshot.effect_id) ?? snapshot;
  if (original.source_kind !== 'spell' || original.source_ref === null)
    return undefined;
  const released = readLinkRows(
    db,
    original.campaign_id,
    original.effect_id,
  ).filter(
    (link) =>
      link.link_kind === 'actor' &&
      link.status === 'released' &&
      link.removed_reason === reasonLabel,
  );
  if (released.length === 0) return undefined;
  const record = lookupCampaignRecord(
    db,
    'spell',
    original.source_ref,
    ctx.resolveRulesPack,
  );
  if (record === undefined) return undefined;
  const removal = deriveUncontrolledRemoval(record);
  if (removal === undefined) return undefined;
  const successorId = uncontrolledSuccessorId(original.effect_id);
  // Unreachable through createActiveEffect, which reserves the suffix and
  // refuses a predecessor whose successor id is taken; this guards corrupt
  // rows only.
  if (readEffectRow(db, original.campaign_id, successorId) !== undefined)
    throw new ActiveEffectError(
      `cannot create the uncontrolled successor '${successorId}' of effect '${original.effect_id}': an effect with that id already exists`,
    );
  if (
    original.duration_kind !== 'timed' ||
    original.duration_amount !== removal.amount ||
    original.duration_unit !== removal.unit ||
    original.anchor_kind === null ||
    !SUMMONING_MOMENT_ANCHORS.includes(original.anchor_kind) ||
    original.anchor_elapsed_minutes === null ||
    original.deadline_elapsed_minutes === null ||
    original.anchor_at === null
  )
    throw new ActiveEffectError(
      `cannot create the uncontrolled successor of effect '${original.effect_id}': '${record.name}' transition '${removal.id}' removes the creature ${removal.amount} ${removal.unit}(s) after '${removal.anchor}', so the effect must be a ${removal.amount}-${removal.unit} timer anchored to '${removal.anchor}' with elapsed-world anchor evidence; it is ${original.duration_kind} ${original.duration_amount ?? ''} ${original.duration_unit ?? ''} anchored to '${original.anchor_kind ?? 'none'}' (elapsed evidence ${original.anchor_elapsed_minutes === null ? 'missing' : 'present'}); the engine will not guess the deadline`,
    );
  const displayName = `${original.display_name} (uncontrolled)`;
  db.prepare(
    `INSERT INTO active_effect(
       campaign_id, effect_id, kind, display_name, source_kind,
       source_ref, source_actor_kind, source_actor_ref,
       requires_concentration, concentration_owner_kind,
       concentration_owner_ref, duration_kind, duration_amount,
       duration_unit, anchor_kind, anchor_at, anchor_game_time,
       anchor_elapsed_minutes, deadline_elapsed_minutes,
       dismissible, status, created_at, provenance, session_id, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, 'timed', ?, ?, ?, ?, ?,
             ?, ?, 0, 'active', ?, ?, ?, ?)`,
  ).run(
    original.campaign_id,
    successorId,
    original.kind,
    displayName,
    original.source_kind,
    original.source_ref,
    original.source_actor_kind,
    original.source_actor_ref,
    original.duration_amount,
    original.duration_unit,
    original.anchor_kind,
    original.anchor_at,
    original.anchor_game_time,
    original.anchor_elapsed_minutes,
    original.deadline_elapsed_minutes,
    ctx.at,
    ctx.provenance,
    ctx.sessionId,
    ctx.at,
  );
  const insertTarget = db.prepare(
    `INSERT INTO active_effect_target(
       campaign_id, effect_id, target_kind, target_ref, status,
       provenance, session_id, updated_at
     )
     VALUES (?, ?, ?, ?, 'active', ?, ?, ?)`,
  );
  const insertLink = db.prepare(
    `INSERT INTO active_effect_link(
       campaign_id, effect_id, link_kind, target_kind, target_ref,
       projection_ref, campaign_actor_id, cleanup_on_end, cleanup_on_break,
       status, provenance, session_id, updated_at, natural_form_json
     )
     VALUES (?, ?, 'actor', ?, ?, ?, ?, 'remove', 'remove', 'active', ?, ?, ?,
             NULL)`,
  );
  const targets: { kind: string; ref: string }[] = [];
  for (const link of released) {
    insertLink.run(
      original.campaign_id,
      successorId,
      link.target_kind,
      link.target_ref,
      link.projection_ref,
      link.campaign_actor_id,
      ctx.provenance,
      ctx.sessionId,
      ctx.at,
    );
    const wasTarget = priorTargets.some(
      (target) =>
        target.status === 'active' &&
        target.target_kind === link.target_kind &&
        target.target_ref === link.target_ref,
    );
    if (wasTarget) {
      insertTarget.run(
        original.campaign_id,
        successorId,
        link.target_kind,
        link.target_ref,
        ctx.provenance,
        ctx.sessionId,
        ctx.at,
      );
      targets.push({ kind: link.target_kind, ref: link.target_ref });
    }
  }
  appendEvent(
    db,
    original.campaign_id,
    successorId,
    'created',
    {
      kind: original.kind,
      displayName,
      source: {
        kind: original.source_kind,
        ref: original.source_ref,
        ...(original.source_actor_kind === null ||
        original.source_actor_ref === null
          ? {}
          : {
              actor: {
                kind: original.source_actor_kind,
                ref: original.source_actor_ref,
              },
            }),
      },
      duration: {
        kind: 'timed',
        amount: original.duration_amount,
        unit: original.duration_unit,
        anchorKind: original.anchor_kind,
        anchorAt: original.anchor_at,
        ...(original.anchor_game_time === null
          ? {}
          : { anchorGameTime: original.anchor_game_time }),
      },
      targets,
      conditions: [],
      actors: released.map((link) => link.projection_ref),
      zones: [],
      forms: [],
      predecessorEffectId: original.effect_id,
      recordTransitionId: removal.id,
    },
    ctx,
  );
  return successorId;
}

// ---------------------------------------------------------------------------
// Spell-record derivation for owned creatures (0-HP rule, cleanup policies)
// ---------------------------------------------------------------------------

interface RecordTransition {
  readonly effectKind: string | undefined;
  readonly profile: string | undefined;
  readonly id: string;
  readonly trigger: string;
  readonly changes: readonly { axis: string; to: string }[];
  /** The `when.control` states the transition applies in (empty when it names none). */
  readonly whenControl: readonly string[];
  readonly timer: { amount: number; unit: string; anchor: string } | undefined;
}

function recordTransitions(record: RulesRecord): RecordTransition[] {
  const mechanics = (record.data as Record<string, unknown> | undefined)
    ?.mechanics;
  const effects =
    typeof mechanics === 'object' && mechanics !== null
      ? (mechanics as Record<string, unknown>).effects
      : undefined;
  const out: RecordTransition[] = [];
  if (!Array.isArray(effects)) return out;
  for (const effect of effects) {
    if (typeof effect !== 'object' || effect === null) continue;
    const e = effect as Record<string, unknown>;
    if (!Array.isArray(e.transitions)) continue;
    for (const raw of e.transitions) {
      if (typeof raw !== 'object' || raw === null) continue;
      const t = raw as Record<string, unknown>;
      if (typeof t.trigger !== 'string') continue;
      out.push({
        effectKind: typeof e.kind === 'string' ? e.kind : undefined,
        profile: typeof e.profile === 'string' ? e.profile : undefined,
        id: typeof t.id === 'string' ? t.id : t.trigger,
        trigger: t.trigger,
        changes: Array.isArray(t.changes)
          ? t.changes.filter(
              (c): c is { axis: string; to: string } =>
                typeof c === 'object' &&
                c !== null &&
                typeof (c as Record<string, unknown>).axis === 'string' &&
                typeof (c as Record<string, unknown>).to === 'string',
            )
          : [],
        whenControl: transitionWhenControl(t.when),
        timer: transitionTimer(t.timer),
      });
    }
  }
  return out;
}

function transitionWhenControl(when: unknown): string[] {
  if (typeof when !== 'object' || when === null) return [];
  const control = (when as Record<string, unknown>).control;
  if (typeof control === 'string') return [control];
  return Array.isArray(control)
    ? control.filter((c): c is string => typeof c === 'string')
    : [];
}

function transitionTimer(
  timer: unknown,
): { amount: number; unit: string; anchor: string } | undefined {
  if (typeof timer !== 'object' || timer === null) return undefined;
  const t = timer as Record<string, unknown>;
  return typeof t.amount === 'number' &&
    typeof t.unit === 'string' &&
    typeof t.anchor === 'string'
    ? { amount: t.amount, unit: t.unit, anchor: t.anchor }
    : undefined;
}

function changesTo(
  transition: RecordTransition,
  axis: string,
  to: string,
): boolean {
  return transition.changes.some((c) => c.axis === axis && c.to === to);
}

/** The creature's 0-hit-point rule, read from the spell record: a transition
 *  on 'zero-hit-points' that destroys the creature, or removes its presence
 *  and ends its part of the effect, means it disappears ('vanish'); one that
 *  removes presence while the effect and link stay active means it
 *  disappears but stays bonded ('vanish-bonded': Find Familiar/Steed, S1
 *  invariant 8); one that restores the original form means it reverts: to an
 *  object that leaves play for an animated-object profile (Animate Objects,
 *  'revert-object'), to the same creature in its natural form for a
 *  target-transformation profile (Giant Insect, 'revert-form'). Any other
 *  profile's original form is unknown, so it is refused rather than
 *  guessed. */
function deriveZeroHpRule(record: RulesRecord): ZeroHpRule | null {
  const rules = new Set<ZeroHpRule>();
  for (const t of recordTransitions(record)) {
    if (t.trigger !== 'zero-hit-points') continue;
    if (changesTo(t, 'integrity', 'destroyed')) rules.add('vanish');
    else if (changesTo(t, 'presence', 'absent'))
      rules.add(
        changesTo(t, 'effect', 'ended') || changesTo(t, 'link', 'none')
          ? 'vanish'
          : 'vanish-bonded',
      );
    else if (changesTo(t, 'form', 'original')) {
      if (t.profile === 'animated-object') rules.add('revert-object');
      else if (t.profile === 'target-transformation') rules.add('revert-form');
      else
        throw new ActiveEffectError(
          `'${record.name}' transition '${t.id}' restores the original form at 0 hit points, but its profile '${t.profile ?? 'none'}' does not say whether that original is an object or a creature; the engine will not guess`,
        );
    }
  }
  if (rules.size > 1)
    throw new ActiveEffectError(
      `'${record.name}' record declares conflicting 0-hit-point transitions (${[...rules].join(', ')}); its zero-hit-point rule is ambiguous`,
    );
  return rules.values().next().value ?? null;
}

interface DerivedSummonCleanup {
  readonly onEnd?: { policy: EffectCleanupPolicy; because: string };
  readonly onBreak?: { policy: EffectCleanupPolicy; because: string };
}

/** Cleanup policies the spell record dictates for a presence-family summon:
 *  spell end removes the creature; a broken concentration either keeps it
 *  (Conjure Elemental/Fey: control -> uncontrolled) or removes it. */
function deriveSummonCleanup(
  record: RulesRecord,
  concentrationRequired: boolean,
): DerivedSummonCleanup {
  const transitions = recordTransitions(record).filter(
    (t) => t.effectKind === 'summoning',
  );
  const spellEnd = transitions.find(
    (t) => t.trigger === 'spell-ended' && changesTo(t, 'presence', 'absent'),
  );
  const brokenKeepsPresence = transitions.find(
    (t) =>
      t.trigger === 'concentration-broken' &&
      !t.changes.some((c) => c.axis === 'presence'),
  );
  const out: {
    onEnd?: { policy: EffectCleanupPolicy; because: string };
    onBreak?: { policy: EffectCleanupPolicy; because: string };
  } = {};
  if (spellEnd !== undefined)
    out.onEnd = {
      policy: 'remove',
      because: `'${record.name}' transition '${spellEnd.id}' (spell-ended) removes the creature`,
    };
  if (brokenKeepsPresence !== undefined)
    out.onBreak = {
      policy: 'release',
      because: `'${record.name}' transition '${brokenKeepsPresence.id}' (concentration-broken) leaves the creature present but uncontrolled`,
    };
  else if (spellEnd !== undefined && concentrationRequired)
    out.onBreak = {
      policy: 'remove',
      because: `'${record.name}' requires concentration and its spell-ended transition '${spellEnd.id}' removes the creature when the spell ends`,
    };
  // Reversion spells: the spell ending reverts the creature to its original
  // form. An animated object stops being a creature (it leaves play); a
  // transformed creature returns to its natural form and stays in play.
  const reversion = transitions.find(
    (t) => t.trigger === 'spell-ended' && changesTo(t, 'form', 'original'),
  );
  if (reversion?.profile === 'animated-object') {
    out.onEnd = {
      policy: 'remove',
      because: `'${record.name}' transition '${reversion.id}' (spell-ended) reverts the animated object to its original object form, so the creature leaves play`,
    };
    if (concentrationRequired)
      out.onBreak = {
        policy: 'remove',
        because: `'${record.name}' requires concentration and its transition '${reversion.id}' reverts the animated object to its original object form when the spell ends, so the creature leaves play`,
      };
  } else if (reversion?.profile === 'target-transformation') {
    out.onEnd = {
      policy: 'revert',
      because: `'${record.name}' transition '${reversion.id}' (spell-ended) returns the creature to its original form, which stays in play`,
    };
    out.onBreak = {
      policy: 'revert',
      because: `'${record.name}' transition '${reversion.id}' returns the creature to its original form when the spell ends, which a broken concentration also ends`,
    };
  } else if (reversion !== undefined)
    throw new ActiveEffectError(
      `'${record.name}' transition '${reversion.id}' restores the original form when the spell ends, but its profile '${reversion.profile ?? 'none'}' does not say whether that original is an object or a creature; the engine will not guess`,
    );
  return out;
}

/** An active actor link whose cleanup policy removes the creature, held by
 *  this combatant or its durable campaign actor. */
export function findRemovePolicyActorLink(
  db: Db,
  campaignId: string,
  holder: { combatantId?: string; actorId?: string },
): { effectId: string } | undefined {
  const match = activeActorLinkMatcher(holder);
  const effectIds = db
    .prepare(
      `SELECT DISTINCT effect_id FROM active_effect_link
       WHERE campaign_id = ? AND link_kind = 'actor' AND status = 'active'
         AND (cleanup_on_end = 'remove' OR cleanup_on_break = 'remove')`,
    )
    .all(campaignId) as { effect_id: string }[];
  for (const { effect_id } of effectIds) {
    const link = readLinkRows(db, campaignId, effect_id).find(
      (candidate) =>
        candidate.link_kind === 'actor' &&
        candidate.status === 'active' &&
        (candidate.cleanup_on_end === 'remove' ||
          candidate.cleanup_on_break === 'remove') &&
        match(candidate),
    );
    if (link !== undefined) return { effectId: effect_id };
  }
  return undefined;
}

function activeActorLinkMatcher(holder: {
  combatantId?: string;
  actorId?: string;
}): (link: EffectLinkRow) => boolean {
  return (link) =>
    (link.target_kind === 'combatant' &&
      holder.combatantId !== undefined &&
      link.projection_ref === holder.combatantId) ||
    (holder.actorId !== undefined &&
      (link.campaign_actor_id === holder.actorId ||
        (link.target_kind === 'campaign_actor' &&
          link.target_ref === holder.actorId)));
}

/**
 * A creature whose own rules say it disappears at 0 hit points just did:
 * close its active actor link (status 'removed', reason zero-hit-points) and,
 * when that was the effect's last owned creature, end the effect through the
 * normal F3 end path with reason 'source-removed'. Runs inside the caller's
 * transaction. Returns the affected effect id (null when the creature held
 * no active link, e.g. after an instance-only release).
 */
export function closeActorLinkAtZeroHp(
  db: Db,
  campaignId: string,
  holder: { combatantId?: string; actorId?: string },
  ctx: EffectMutationContext,
  /** 'keep' for a bonded creature ('vanish-bonded'): its absence does not
   *  end the link or the effect; only the owning effect id is reported. */
  mode: 'close' | 'keep' = 'close',
  /** How the creature's part ended: 'left-play' (it disappeared, or reverted
   *  to an object), or 'reverted-form' (it returned to its natural form and
   *  stays in play). Only the audit ledger text differs. */
  how: 'left-play' | 'reverted-form' = 'left-play',
): { effectId: string | null; effectEnded: boolean } {
  const match = activeActorLinkMatcher(holder);
  const effectIds = db
    .prepare(
      `SELECT DISTINCT effect_id FROM active_effect_link
       WHERE campaign_id = ? AND link_kind = 'actor' AND status = 'active'
       ORDER BY effect_id`,
    )
    .all(campaignId) as { effect_id: string }[];
  for (const { effect_id } of effectIds) {
    const link = readLinkRows(db, campaignId, effect_id).find(
      (candidate) =>
        candidate.link_kind === 'actor' &&
        candidate.status === 'active' &&
        match(candidate),
    );
    if (link === undefined) continue;
    if (mode === 'keep') return { effectId: effect_id, effectEnded: false };
    db.prepare(
      `UPDATE active_effect_link
       SET status = 'removed', removed_reason = 'zero-hit-points', removed_at = ?,
           provenance = ?, session_id = ?, updated_at = ?
       WHERE campaign_id = ? AND effect_id = ? AND link_kind = ?
         AND target_kind = ? AND target_ref = ? AND projection_ref = ?`,
    ).run(
      ctx.at,
      ctx.provenance,
      ctx.sessionId,
      ctx.at,
      campaignId,
      effect_id,
      link.link_kind,
      link.target_kind,
      link.target_ref,
      link.projection_ref,
    );
    db.prepare(
      `UPDATE active_effect_target
       SET status = 'removed', removed_reason = 'zero-hit-points',
           removed_at = ?, provenance = ?, session_id = ?, updated_at = ?
       WHERE campaign_id = ? AND effect_id = ? AND status = 'active'
         AND target_kind = ? AND target_ref = ?`,
    ).run(
      ctx.at,
      ctx.provenance,
      ctx.sessionId,
      ctx.at,
      campaignId,
      effect_id,
      link.target_kind,
      link.target_ref,
    );
    const effect = readEffectRow(db, campaignId, effect_id);
    if (effect === undefined || effect.status === 'ended')
      return { effectId: effect_id, effectEnded: false };
    appendEvent(
      db,
      campaignId,
      effect_id,
      'target-removed',
      {
        target: { kind: link.target_kind, ref: link.target_ref },
        reason: 'zero-hit-points',
        cleanup: [
          {
            linkKind: link.link_kind,
            targetKind: link.target_kind,
            targetRef: link.target_ref,
            projectionRef: link.projection_ref,
            action: how === 'reverted-form' ? 'reverted' : 'removed',
          },
        ],
      },
      ctx,
    );
    const ownsMore = readLinkRows(db, campaignId, effect_id).some(
      (candidate) =>
        candidate.link_kind === 'actor' && candidate.status === 'active',
    );
    if (ownsMore) return { effectId: effect_id, effectEnded: false };
    const outcome = finalizeEnd(
      db,
      effect,
      {
        reason: 'source-removed',
        detail: 'zero-hit-points',
        note:
          how === 'reverted-form'
            ? `its last owned creature '${link.projection_ref}' dropped to 0 hit points and returned to its natural form`
            : `its last owned creature '${link.projection_ref}' dropped to 0 hit points and left play`,
      },
      ctx,
    );
    return { effectId: effect_id, effectEnded: outcome.performed };
  }
  return { effectId: null, effectEnded: false };
}

/** eshyra-qxnc: the bonded-summon effect of an instantaneous spell record: a
 *  summoning effect whose identity is persistent-linked and whose initial link
 *  is active (Find Familiar, Find Steed). The record, never the spell's name,
 *  decides it. `maximumLinked` is the identity's positive-integer limit. */
function findPersistentBondEffect(
  record: RulesRecord,
): { maximumLinked: number | undefined } | undefined {
  const mechanics = asObject(asObject(record.data)?.mechanics);
  const effects = Array.isArray(mechanics?.effects) ? mechanics.effects : [];
  for (const raw of effects) {
    const effect = asObject(raw);
    const identity = asObject(effect?.identity);
    if (
      effect?.kind !== 'summoning' ||
      identity?.kind !== 'persistent-linked' ||
      asObject(effect.initialState)?.link !== 'active'
    )
      continue;
    const max = identity.maximumLinked;
    return {
      maximumLinked:
        typeof max === 'number' && Number.isInteger(max) && max > 0
          ? max
          : undefined,
    };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// createActiveEffect
// ---------------------------------------------------------------------------

export function createActiveEffect(
  db: Db,
  input: CreateActiveEffectInput,
): CreateActiveEffectResult {
  return withTransaction(db, (txnDb) => {
    // ---- validation: nothing below mutates until every check passes ----
    requireNonEmptyString(input.campaignId, 'campaignId');
    requireNonEmptyString(input.effectId, 'effectId');
    requireNonEmptyString(input.displayName, 'displayName');
    if (!ACTIVE_EFFECT_KINDS.includes(input.kind)) {
      throw new ActiveEffectError(
        `unknown effect kind '${input.kind}'; expected one of: ${ACTIVE_EFFECT_KINDS.join(', ')}`,
      );
    }
    const profile = EFFECT_KIND_PROFILES[input.kind];

    if (readEffectRow(txnDb, input.campaignId, input.effectId) !== undefined) {
      throw new ActiveEffectError(
        `an effect with id '${input.effectId}' already exists; effect ids are stable identities and are never reused`,
      );
    }
    // '<id>:uncontrolled' is the engine-owned identity of the successor a
    // concentration break creates (Conjure Elemental/Fey). A caller may never
    // claim it: the break must always be able to create it.
    if (input.effectId.endsWith(UNCONTROLLED_SUCCESSOR_SUFFIX)) {
      throw new ActiveEffectError(
        `effect id '${input.effectId}' ends with '${UNCONTROLLED_SUCCESSOR_SUFFIX}', which is reserved for the uncontrolled successor the engine creates when concentration on Conjure Elemental or Conjure Fey breaks; choose another id`,
      );
    }

    // Source grounding.
    if (!profile.sourceKinds.includes(input.source.kind)) {
      throw new ActiveEffectError(
        `a '${input.kind}' effect cannot come from source kind '${input.source.kind}' ` +
          `(allowed: ${profile.sourceKinds.join(', ')})`,
      );
    }
    let concentrationRule: 'required' | 'forbidden' | 'declared' = 'declared';
    let recordDuration: ParsedSpellDurationForm | undefined;
    let spellRecord: RulesRecord | undefined;
    let bondedSummon: { maximumLinked: number | undefined } | undefined;
    if (input.source.kind === 'spell') {
      const ref = requireNonEmptyString(
        input.source.ref,
        "a spell-sourced effect's source.ref",
      );
      const record = lookupCampaignRecord(
        txnDb,
        'spell',
        ref,
        input.resolveRulesPack,
      );
      if (record === undefined) {
        throw new ActiveEffectError(
          `source.ref '${ref}' does not resolve to a spell record in the campaign rules stack; ` +
            "find the exact key via lookup_rules, or use source kind 'ruling' for homebrew",
        );
      }
      spellRecord = record;
      const data = record.data as Record<string, unknown>;
      if (typeof data.duration === 'string') {
        const parsed = parseSpellDurationText(data.duration);
        concentrationRule = parsed.concentration ? 'required' : 'forbidden';
        recordDuration = parsed.form;
        if (parsed.form.kind === 'instantaneous') {
          const bondEffect =
            input.kind === 'summoning'
              ? findPersistentBondEffect(record)
              : undefined;
          if (bondEffect === undefined)
            throw new ActiveEffectError(
              `'${record.name}' is instantaneous per its record; instantaneous spells leave no ` +
                'active effect — their consequences land through their own mutations',
            );
          bondedSummon = bondEffect;
        }
      }
    } else if (
      input.source.kind === 'magic-item' &&
      input.source.ref !== undefined
    ) {
      const record = lookupCampaignRecord(
        txnDb,
        'magic-item',
        input.source.ref,
        input.resolveRulesPack,
      );
      if (record === undefined) {
        throw new ActiveEffectError(
          `source.ref '${input.source.ref}' does not resolve to a magic-item record; ` +
            'find the exact key via lookup_rules or omit the ref for homebrew items',
        );
      }
    }
    if (input.source.actor !== undefined) {
      requireParticipant(
        txnDb,
        input.campaignId,
        input.source.actor,
        'source.actor',
      );
    }

    if (bondedSummon !== undefined) {
      if (input.duration.kind !== 'until-removed')
        throw new ActiveEffectError(
          `'${spellRecord?.name}' bonds its creature until it is released or dismissed, so the effect lasts until removed: declare an 'until-removed' duration`,
        );
      if (input.source.actor === undefined)
        throw new ActiveEffectError(
          `'${spellRecord?.name}' bonds its creature to the caster: declare source.actor (the caster the creature is bonded to)`,
        );
      // The bond outlives any combat instance, so its caster needs a durable
      // identity; a combatant id names one projection in one instance.
      if (input.source.actor.kind === 'combatant')
        throw new ActiveEffectError(
          `'${spellRecord?.name}' bonds its creature to the caster beyond any one combat: declare source.actor as the caster's character or campaign_actor, not combatant '${input.source.actor.ref}'`,
        );
      const linked = (input.actors ?? []).length;
      const max = bondedSummon.maximumLinked;
      if (linked < 1 || (max !== undefined && linked > max))
        throw new ActiveEffectError(
          `'${spellRecord?.name}' bonds ${max === undefined ? 'at least one creature' : `at most ${max} creature${max === 1 ? '' : 's'}`} per casting; ${linked} actors entries were declared`,
        );
      const held = txnDb
        .prepare(
          `SELECT e.effect_id FROM active_effect e
           WHERE e.campaign_id = ? AND e.status IN ('active', 'suppressed')
             AND e.source_kind = 'spell' AND e.source_ref = ?
             AND e.source_actor_kind = ? AND e.source_actor_ref = ?
             AND EXISTS (
               SELECT 1 FROM active_effect_link l
               WHERE l.campaign_id = e.campaign_id AND l.effect_id = e.effect_id
                 AND l.link_kind = 'actor' AND l.status = 'active')
           ORDER BY e.effect_id LIMIT 1`,
        )
        .get(
          input.campaignId,
          input.source.ref,
          input.source.actor.kind,
          input.source.actor.ref,
        ) as { effect_id: string } | undefined;
      if (held !== undefined)
        throw new ActiveEffectError(
          `${input.source.actor.kind} '${input.source.actor.ref}' already holds a '${spellRecord?.name}' bond: effect '${held.effect_id}'. A caster has one such bond at a time; casting the spell again while the bond lasts is recast_bonded_summon (Find Familiar reforms the familiar, Find Steed restores an absent steed), and ending effect '${held.effect_id}' releases the bond`,
        );
    }

    // Concentration.
    if (profile.concentration === 'forbidden') {
      if (input.concentration !== undefined) {
        throw new ActiveEffectError(
          `a '${input.kind}' effect cannot require concentration`,
        );
      }
      if (concentrationRule === 'required') {
        throw new ActiveEffectError(
          `the spell record says this effect requires concentration, which a '${input.kind}' ` +
            "effect cannot carry; model it as a concentration-capable kind (e.g. 'spell-effect')",
        );
      }
    } else if (
      concentrationRule === 'required' &&
      input.concentration === undefined
    ) {
      throw new ActiveEffectError(
        'the spell record requires concentration: declare concentration.owner',
      );
    } else if (
      concentrationRule === 'forbidden' &&
      input.concentration !== undefined
    ) {
      throw new ActiveEffectError(
        'the spell record does not require concentration: do not declare a concentration owner',
      );
    }
    if (input.concentration !== undefined) {
      requireParticipant(
        txnDb,
        input.campaignId,
        input.concentration.owner,
        'concentration.owner',
      );
      requireConcentrationCapableOwner(
        txnDb,
        input.campaignId,
        input.concentration.owner,
        input.resolveRulesPack,
      );
    }

    // Read (not yet end) the concentration effect this creation will replace,
    // so collision/ownership validation below can be evaluated against the
    // post-replacement state without mutating anything before validation
    // completes: a recast of the same spell may re-project condition ids the
    // replacement break is about to remove.
    const priorConcentration =
      input.concentration === undefined
        ? undefined
        : (txnDb
            .prepare(
              `SELECT ${EFFECT_COLUMNS} FROM active_effect
               WHERE campaign_id = ? AND requires_concentration = 1
                 AND concentration_owner_kind = ?
                 AND concentration_owner_ref = ?
                 AND status IN ('active', 'suppressed')`,
            )
            .get(
              input.campaignId,
              input.concentration.owner.kind,
              input.concentration.owner.ref,
            ) as ActiveEffectRow | undefined);
    const replacementRemovals = new Set<string>();
    if (priorConcentration !== undefined) {
      for (const link of readLinkRows(
        txnDb,
        input.campaignId,
        priorConcentration.effect_id,
      )) {
        if (link.status === 'active' && link.cleanup_on_break === 'remove') {
          replacementRemovals.add(
            `${link.link_kind}:${link.target_kind}:${link.target_ref}:${link.projection_ref}`,
          );
        }
      }
    }

    // Duration (+ record grounding).
    const dismissible =
      input.dismissible === true || input.duration.kind === 'until-dismissed';
    if (
      input.duration.kind === 'until-dismissed' &&
      input.dismissible === false
    ) {
      throw new ActiveEffectError(
        "an 'until-dismissed' effect must be dismissible",
      );
    }
    const duration = validateDuration(
      txnDb,
      input.campaignId,
      input.duration,
      dismissible,
      input.source.kind,
      input,
      input.source.actor,
      input.targets ?? [],
    );
    if (recordDuration !== undefined) {
      if (recordDuration.kind === 'timed') {
        if (
          duration.kind !== 'timed' ||
          duration.amount !== recordDuration.amount ||
          duration.unit !== recordDuration.unit
        ) {
          throw new ActiveEffectError(
            `the spell record's duration is ${recordDuration.amount} ${recordDuration.unit}(s); ` +
              'the declared duration must match it (the effect can still end early by ' +
              'dismissal, concentration loss, or dispel)',
          );
        }
      } else if (
        recordDuration.kind === 'until-dispelled' &&
        duration.kind !== 'until-removed'
      ) {
        throw new ActiveEffectError(
          "the spell record's duration is 'until dispelled': declare an 'until-removed' duration",
        );
      } else if (
        recordDuration.kind === 'until-dispelled-or-triggered' &&
        duration.kind !== 'until-trigger'
      ) {
        throw new ActiveEffectError(
          "the spell record's duration is 'until dispelled or triggered': declare an " +
            "'until-trigger' duration naming the trigger",
        );
      }
    }

    const { anchor: worldAnchor, deadline: worldDeadline } =
      elapsedWorldDeadline(txnDb, duration);

    // Targets.
    const targets = input.targets ?? [];
    const seenTargets = new Set<string>();
    for (const target of targets) {
      requireNonEmptyString(target.ref, 'target ref');
      if (
        target.kind !== 'character' &&
        target.kind !== 'combatant' &&
        target.kind !== 'campaign_actor' &&
        target.kind !== 'scope'
      ) {
        throw new ActiveEffectError(
          "target kind must be 'character', 'combatant', 'campaign_actor', or 'scope'",
        );
      }
      const key = `${target.kind}:${target.ref}`;
      if (seenTargets.has(key)) {
        throw new ActiveEffectError(`duplicate target ${key}`);
      }
      seenTargets.add(key);
      if (target.kind !== 'scope') {
        requireParticipant(
          txnDb,
          input.campaignId,
          { kind: target.kind, ref: target.ref },
          'target',
        );
      }
    }

    // Condition projections.
    const conditions = input.conditions ?? [];
    if (conditions.length > 0 && !profile.linkKinds.includes('condition')) {
      throw new ActiveEffectError(
        `a '${input.kind}' effect cannot project conditions`,
      );
    }
    const seenProjections = new Set<string>();
    for (const projection of conditions) {
      requireParticipant(
        txnDb,
        input.campaignId,
        projection.target,
        'condition projection target',
      );
      validateConditionsJson([projection.condition], 'condition projection');
      for (const policy of [projection.cleanupOnEnd, projection.cleanupOnBreak])
        if (policy !== undefined && policy !== 'remove' && policy !== 'release')
          throw new ActiveEffectError(
            `condition projection '${projection.condition.id}' cleanup '${policy}' is unsupported: 'revert' is legal only on an actor link that records a natural form`,
          );
      const key = `${projection.target.kind}:${projection.target.ref}:${projection.condition.id}`;
      if (seenProjections.has(key)) {
        throw new ActiveEffectError(
          `duplicate condition projection '${projection.condition.id}' on ` +
            `${projection.target.kind} '${projection.target.ref}'`,
        );
      }
      seenProjections.add(key);
      // Unsupported topology (audit §4): a concentration effect that projects
      // an incapacitating condition onto its own concentration owner would
      // end itself during creation — reject at preflight instead.
      if (
        input.concentration !== undefined &&
        projection.target.kind === input.concentration.owner.kind &&
        projection.target.ref === input.concentration.owner.ref &&
        conditionImpliesIncapacitated(
          txnDb,
          projection.condition.id,
          input.resolveRulesPack,
        )
      ) {
        throw new ActiveEffectError(
          `condition '${projection.condition.id}' incapacitates, and its target is this ` +
            "effect's own concentration owner — the effect would break itself; this " +
            'topology is rejected before any write',
        );
      }
      const existing = readParticipantConditionIds(
        txnDb,
        input.campaignId,
        projection.target,
      );
      // A collision with a projection the concentration replacement is about
      // to remove is not a collision: validation sees post-replacement state.
      if (
        existing.includes(projection.condition.id) &&
        !replacementRemovals.has(`condition:${key}`)
      ) {
        throw new ActiveEffectError(
          `${projection.target.kind} '${projection.target.ref}' already has a condition ` +
            `'${projection.condition.id}'; an effect can only own projections it created — ` +
            'use a distinct condition id, or rule on same-effect non-stacking first',
        );
      }
    }

    // Actor links.
    const actors = input.actors ?? [];
    if (actors.length > 0 && !profile.linkKinds.includes('actor')) {
      throw new ActiveEffectError(
        `a '${input.kind}' effect cannot own linked actors`,
      );
    }
    const seenActors = new Set<string>();
    const actorDurableIds = new Map<string, string>();
    const actorPolicies = new Map<
      string,
      { onEnd: EffectCleanupPolicy; onBreak: EffectCleanupPolicy }
    >();
    const actorZeroHpRules = new Map<string, ZeroHpRule>();
    const derivedZeroHpRule =
      spellRecord === undefined ? null : deriveZeroHpRule(spellRecord);
    const derivedCleanup: DerivedSummonCleanup =
      spellRecord === undefined || input.kind !== 'summoning'
        ? {}
        : deriveSummonCleanup(spellRecord, concentrationRule === 'required');
    // A creature the record removes a fixed time after it was summoned once
    // uncontrolled (Conjure Elemental/Fey) inherits this effect's anchor when
    // a broken concentration hands it to the successor. Gate the anchor here,
    // so the break (which must never fail) always has a summoning-moment
    // deadline to copy.
    const uncontrolledRemoval =
      spellRecord === undefined || input.kind !== 'summoning'
        ? undefined
        : deriveUncontrolledRemoval(spellRecord);
    if (
      uncontrolledRemoval !== undefined &&
      (duration.kind !== 'timed' ||
        duration.amount !== uncontrolledRemoval.amount ||
        duration.unit !== uncontrolledRemoval.unit ||
        duration.anchorKind === null ||
        !SUMMONING_MOMENT_ANCHORS.includes(duration.anchorKind))
    )
      throw new ActiveEffectError(
        `'${spellRecord?.name}' transition '${uncontrolledRemoval.id}' removes an uncontrolled creature ${uncontrolledRemoval.amount} ${uncontrolledRemoval.unit}(s) after it was summoned, so the effect must be a ${uncontrolledRemoval.amount}-${uncontrolledRemoval.unit} timer anchored to 'spell-cast' or 'effect-created' (the moment of summoning)`,
      );
    // The other admission direction: an effect stored under the derived
    // successor id before the suffix was reserved would make the break fail.
    if (
      uncontrolledRemoval !== undefined &&
      readEffectRow(
        txnDb,
        input.campaignId,
        uncontrolledSuccessorId(input.effectId),
      ) !== undefined
    )
      throw new ActiveEffectError(
        `effect id '${input.effectId}' cannot be used for '${spellRecord?.name}': its uncontrolled successor id '${uncontrolledSuccessorId(input.effectId)}' is already taken, so a broken concentration could not hand the creature over; choose another id`,
      );
    for (const actor of actors) {
      requireNonEmptyString(actor.combatantId, 'linked actor combatantId');
      if (seenActors.has(actor.combatantId)) {
        throw new ActiveEffectError(
          `duplicate linked actor '${actor.combatantId}'`,
        );
      }
      seenActors.add(actor.combatantId);
      requireParticipant(
        txnDb,
        input.campaignId,
        { kind: 'combatant', ref: actor.combatantId },
        'linked actor',
      );
      const combatant = txnDb
        .prepare(
          `SELECT identity_kind, identity_ref, rules_ref, death_rules,
                  zero_hp_rule, hp_current, status
         FROM encounter_combatant
         WHERE campaign_id = ? AND combatant_id = ?`,
        )
        .get(input.campaignId, actor.combatantId) as
        | {
            identity_kind: string;
            identity_ref: string | null;
            rules_ref: string;
            death_rules: string;
            zero_hp_rule: ZeroHpRule | null;
            hp_current: number;
            status: string;
          }
        | undefined;
      // Owned-creature rules: the 0-hit-point rule and cleanup policies are
      // derived from the spell record; declarations may not contradict it.
      if (
        actor.atZeroHitPoints !== undefined &&
        actor.atZeroHitPoints !== 'vanish' &&
        actor.atZeroHitPoints !== 'vanish-bonded'
      )
        throw new ActiveEffectError(
          "atZeroHitPoints must be 'vanish' or 'vanish-bonded' when declared",
        );
      if (
        derivedZeroHpRule !== null &&
        actor.atZeroHitPoints !== undefined &&
        (derivedZeroHpRule as ZeroHpRule) !== actor.atZeroHitPoints
      )
        throw new ActiveEffectError(
          `'${spellRecord?.name}' record says its creature ${
            derivedZeroHpRule === 'vanish-bonded'
              ? 'disappears but stays bonded'
              : derivedZeroHpRule === 'vanish'
                ? 'disappears and its part of the effect ends'
                : describeZeroHpRule(derivedZeroHpRule)
          } at 0 hit points (rule '${derivedZeroHpRule}'); atZeroHitPoints '${actor.atZeroHitPoints}' contradicts it`,
        );
      const declaredZeroHpRule: ZeroHpRule | null =
        derivedZeroHpRule ?? actor.atZeroHitPoints ?? null;
      if (
        declaredZeroHpRule !== null &&
        combatant?.zero_hp_rule != null &&
        combatant.zero_hp_rule !== declaredZeroHpRule
      )
        throw new ActiveEffectError(
          `combatant '${actor.combatantId}' already has the 0-hit-point rule '${combatant.zero_hp_rule}', which contradicts '${declaredZeroHpRule}'`,
        );
      const effectiveZeroHpRule: ZeroHpRule | null =
        declaredZeroHpRule ?? combatant?.zero_hp_rule ?? null;
      // The natural form is the snapshot a form reversion restores: recorded
      // exactly when the spell record's rule is 'revert-form', never else.
      if (actor.naturalForm !== undefined && !isNaturalForm(actor.naturalForm))
        throw new ActiveEffectError(
          `linked actor '${actor.combatantId}' naturalForm must be { hpCurrent: integer above 0, hpMax: integer at least hpCurrent, rulesRef: non-empty string }`,
        );
      if (derivedZeroHpRule === 'revert-form') {
        if (actor.naturalForm === undefined)
          throw new ActiveEffectError(
            `linked actor '${actor.combatantId}' needs naturalForm: '${spellRecord?.name}' transforms an existing creature and returns it to its original form at 0 hit points, so record the hit points (hpCurrent, hpMax) and rulesRef it has at cast`,
          );
      } else if (actor.naturalForm !== undefined)
        throw new ActiveEffectError(
          `linked actor '${actor.combatantId}' naturalForm is refused: only a spell whose record returns the creature to its original form at 0 hit points (a target transformation such as Giant Insect) records a natural form`,
        );
      if (
        effectiveZeroHpRule === 'revert-form' &&
        derivedZeroHpRule !== 'revert-form'
      )
        throw new ActiveEffectError(
          `combatant '${actor.combatantId}' already has the 0-hit-point rule 'revert-form' from another effect, which only the transformation spell that set it may link`,
        );
      // A bond that survives absence is a persistent identity (S1 invariant
      // 8); combat closure releases instance-only links, so the creature
      // needs a durable campaign-actor identity (S50).
      if (
        effectiveZeroHpRule === 'vanish-bonded' &&
        actor.campaignActorId === undefined &&
        combatant?.identity_kind !== 'campaign_actor'
      )
        throw new ActiveEffectError(
          `linked actor '${actor.combatantId}' has the 'vanish-bonded' rule (a persistent bond such as a familiar or steed) but no durable identity; ` +
            'pass campaignActorId so the bond survives combat closing',
        );
      let onEnd = actor.cleanupOnEnd;
      let onBreak = actor.cleanupOnBreak;
      if (
        (onEnd === 'revert' || onBreak === 'revert') &&
        actor.naturalForm === undefined
      )
        throw new ActiveEffectError(
          `linked actor '${actor.combatantId}' cleanup 'revert' is legal only on an actor link that records a natural form (naturalForm)`,
        );
      if (derivedCleanup.onEnd !== undefined) {
        if (onEnd !== undefined && onEnd !== derivedCleanup.onEnd.policy)
          throw new ActiveEffectError(
            `cleanupOnEnd '${onEnd}' contradicts the spell record: ${derivedCleanup.onEnd.because}; it must be '${derivedCleanup.onEnd.policy}'`,
          );
        onEnd = derivedCleanup.onEnd.policy;
      }
      if (derivedCleanup.onBreak !== undefined) {
        if (onBreak !== undefined && onBreak !== derivedCleanup.onBreak.policy)
          throw new ActiveEffectError(
            `cleanupOnBreak '${onBreak}' contradicts the spell record: ${derivedCleanup.onBreak.because}; it must be '${derivedCleanup.onBreak.policy}'`,
          );
        onBreak = derivedCleanup.onBreak.policy;
      }
      const policies = {
        onEnd: onEnd ?? 'remove',
        onBreak: onBreak ?? 'remove',
      };
      actorPolicies.set(actor.combatantId, policies);
      if (effectiveZeroHpRule !== null)
        actorZeroHpRules.set(actor.combatantId, effectiveZeroHpRule);
      if (
        combatant?.death_rules === 'player-character' &&
        (effectiveZeroHpRule !== null ||
          policies.onEnd === 'remove' ||
          policies.onBreak === 'remove')
      )
        throw new ActiveEffectError(
          `combatant '${actor.combatantId}' already uses player-character death rules, so it can be dying or stable and could not be taken out of play: ${
            effectiveZeroHpRule !== null
              ? `its spell says it ${describeZeroHpRule(
                  effectiveZeroHpRule,
                )} at 0 hit points`
              : "a 'remove' cleanup policy needs to be able to take it out of play"
          }`,
        );
      if (
        (leavesPlayAtZeroHp(effectiveZeroHpRule) ||
          effectiveZeroHpRule === 'revert-form') &&
        combatant !== undefined &&
        combatant.hp_current === 0 &&
        combatant.status !== 'dead'
      )
        throw new ActiveEffectError(
          `combatant '${actor.combatantId}' is already at 0 hit points, where a creature whose spell says it ${describeZeroHpRule(
            effectiveZeroHpRule as ZeroHpRule,
          )} at 0 hit points would already be gone or reverted; it cannot be linked`,
        );
      if (
        effectiveZeroHpRule !== null &&
        combatant?.zero_hp_rule !== effectiveZeroHpRule
      )
        setCombatantZeroHpRule(txnDb, {
          campaignId: input.campaignId,
          combatantId: actor.combatantId,
          rule: effectiveZeroHpRule,
          provenance: input.provenance,
          sessionId: input.sessionId,
          at: input.at,
        });
      const durableId =
        actor.campaignActorId ??
        (combatant?.identity_kind === 'campaign_actor'
          ? (combatant.identity_ref ?? undefined)
          : undefined);
      if (
        actor.campaignActorId !== undefined &&
        combatant?.identity_kind === 'campaign_actor' &&
        combatant.identity_ref !== actor.campaignActorId
      ) {
        throw new ActiveEffectError(
          `linked actor '${actor.combatantId}' campaign actor identity does not match its projection`,
        );
      }
      if (durableId !== undefined) {
        actorDurableIds.set(actor.combatantId, durableId);
        const claimed = txnDb
          .prepare(
            `SELECT effect_id FROM active_effect_link WHERE campaign_id = ? AND link_kind = 'actor'
           AND campaign_actor_id = ? AND status = 'active'`,
          )
          .get(input.campaignId, durableId) as
          | { effect_id: string }
          | undefined;
        if (
          claimed !== undefined &&
          claimed.effect_id !== input.effectId &&
          claimed.effect_id !== priorConcentration?.effect_id
        ) {
          throw new ActiveEffectError(
            `campaign actor '${durableId}' is already owned by effect '${claimed.effect_id}'`,
          );
        }
        ensureCampaignActorFromCombatant(txnDb, {
          campaignId: input.campaignId,
          combatantId: actor.combatantId,
          actorId: durableId,
          provenance: input.provenance,
          sessionId: input.sessionId,
          at: input.at,
        });
      }
      const owner = txnDb
        .prepare(
          `SELECT effect_id FROM active_effect_link
           WHERE campaign_id = ? AND link_kind = 'actor'
             AND projection_ref = ? AND status = 'active'`,
        )
        .get(input.campaignId, actor.combatantId) as
        | { effect_id: string }
        | undefined;
      // Links owned by the effect the replacement is about to end all close
      // with it, so they do not block the new effect's ownership.
      if (
        owner !== undefined &&
        owner.effect_id !== priorConcentration?.effect_id
      ) {
        throw new ActiveEffectError(
          `combatant '${actor.combatantId}' is already owned by effect '${owner.effect_id}'; ` +
            'an entity has at most one owning effect',
        );
      }
    }

    // Canonical zone projections. A zone is itself the spatial state; its
    // scope holder may be narrative rather than a creature.
    const zones = input.zones ?? [];
    if (zones.length > 0 && !profile.linkKinds.includes('zone')) {
      throw new ActiveEffectError(
        `a '${input.kind}' effect cannot project zones`,
      );
    }
    const seenZones = new Set<string>();
    for (const zone of zones) {
      requireNonEmptyString(zone.zoneId, 'zone projection zoneId');
      requireNonEmptyString(zone.scopeRef, 'zone projection scopeRef');
      if (
        !['sphere', 'cube', 'cylinder', 'cone', 'line'].includes(zone.shape)
      ) {
        throw new ActiveEffectError(
          `zone projection shape '${zone.shape}' is unsupported`,
        );
      }
      if (!Number.isInteger(zone.sizeFeet) || zone.sizeFeet < 1) {
        throw new ActiveEffectError(
          'zone projection sizeFeet must be a positive integer',
        );
      }
      if (
        zone.cleanupOnEnd === 'release' ||
        zone.cleanupOnBreak === 'release' ||
        zone.cleanupOnEnd === 'revert' ||
        zone.cleanupOnBreak === 'revert'
      ) {
        throw new ActiveEffectError(
          'zone projections require remove cleanup; released or reverted zones have no supported mutation lifecycle',
        );
      }
      if (seenZones.has(zone.zoneId))
        throw new ActiveEffectError(
          `duplicate zone projection '${zone.zoneId}'`,
        );
      seenZones.add(zone.zoneId);
      if (
        txnDb
          .prepare(
            'SELECT 1 FROM effect_spatial_zone WHERE campaign_id = ? AND zone_id = ?',
          )
          .get(input.campaignId, zone.zoneId) !== undefined &&
        !replacementRemovals.has(`zone:scope:${zone.scopeRef}:${zone.zoneId}`)
      ) {
        throw new ActiveEffectError(
          `spatial zone '${zone.zoneId}' already exists; an effect can only own a projection it created`,
        );
      }
    }

    const forms = input.forms ?? [];
    if (forms.length > 0 && !profile.linkKinds.includes('form')) {
      throw new ActiveEffectError(
        `a '${input.kind}' effect cannot project forms`,
      );
    }
    const seenForms = new Set<string>();
    for (const form of forms) {
      requireParticipant(
        txnDb,
        input.campaignId,
        form.target,
        'form projection target',
      );
      requireNonEmptyString(form.formRef, 'form projection formRef');
      if (
        form.cleanupOnEnd === 'release' ||
        form.cleanupOnBreak === 'release' ||
        form.cleanupOnEnd === 'revert' ||
        form.cleanupOnBreak === 'revert'
      ) {
        throw new ActiveEffectError(
          'form projections require remove cleanup; released or reverted forms have no supported mutation lifecycle',
        );
      }
      const key = `${form.target.kind}:${form.target.ref}`;
      if (seenForms.has(key))
        throw new ActiveEffectError(`duplicate form projection target ${key}`);
      seenForms.add(key);
      if (
        txnDb
          .prepare(
            'SELECT 1 FROM effect_transformation_form WHERE campaign_id = ? AND target_kind = ? AND target_ref = ?',
          )
          .get(input.campaignId, form.target.kind, form.target.ref) !==
          undefined &&
        ![...replacementRemovals].some((key) =>
          key.startsWith(`form:${form.target.kind}:${form.target.ref}:`),
        )
      ) {
        throw new ActiveEffectError(
          `${form.target.kind} '${form.target.ref}' already has a projected form; end that form before applying another`,
        );
      }
    }

    // ---- writes ----

    // Concentration replacement: starting to concentrate ends the prior
    // concentration effect deterministically (SRD concentration).
    let replaced: CreateActiveEffectResult['replaced'];
    if (priorConcentration !== undefined) {
      // Fresh row: read during validation with no mutations in between; the
      // primitive re-verifies against the durable row regardless.
      const outcome = finalizeEnd(
        txnDb,
        priorConcentration,
        {
          reason: 'concentration-broken',
          detail: 'new-concentration',
          note: `replaced by effect '${input.effectId}'`,
        },
        input,
      );
      if (outcome.performed) {
        replaced = {
          effectId: priorConcentration.effect_id,
          displayName: priorConcentration.display_name,
          cleanup: outcome.cleanup,
        };
      }
      // The replaced effect's cleanup may have taken creatures out of play
      // (e.g. a recast Conjure Animals: the first casting's beasts disappear
      // when it ends). Participants were validated before that cleanup, so
      // re-check them: the new effect cannot use a creature that just left.
      const participants: [EffectParticipant, string][] = [
        ...(input.source.actor === undefined
          ? []
          : [
              [input.source.actor, 'source.actor'] as [
                EffectParticipant,
                string,
              ],
            ]),
        ...(input.concentration === undefined
          ? []
          : [
              [input.concentration.owner, 'concentration.owner'] as [
                EffectParticipant,
                string,
              ],
            ]),
        ...targets
          .filter((t) => t.kind !== 'scope')
          .map(
            (t) =>
              [{ kind: t.kind, ref: t.ref } as EffectParticipant, 'target'] as [
                EffectParticipant,
                string,
              ],
          ),
        ...conditions.map(
          (c) =>
            [c.target, 'condition projection target'] as [
              EffectParticipant,
              string,
            ],
        ),
        ...actors.map(
          (a) =>
            [
              { kind: 'combatant', ref: a.combatantId } as EffectParticipant,
              'linked actor',
            ] as [EffectParticipant, string],
        ),
        ...forms.map(
          (f) =>
            [f.target, 'form projection target'] as [EffectParticipant, string],
        ),
      ];
      for (const [participant, label] of participants) {
        const status =
          participant.kind === 'combatant'
            ? readCombatantParticipant(txnDb, input.campaignId, participant.ref)
                ?.status
            : participant.kind === 'campaign_actor'
              ? getCampaignActor(txnDb, input.campaignId, participant.ref)
                  ?.status
              : undefined;
        if (status === 'absent')
          throw new ActiveEffectError(
            `${label} '${participant.ref}' left play when effect '${priorConcentration.effect_id}' ended ` +
              `(its concentration was replaced by '${input.effectId}'); a new casting needs creatures that are still in play`,
          );
      }
    }

    txnDb
      .prepare(
        `INSERT INTO active_effect(
           campaign_id, effect_id, kind, display_name, source_kind,
           source_ref, source_actor_kind, source_actor_ref,
           requires_concentration, concentration_owner_kind,
           concentration_owner_ref, duration_kind, duration_amount,
           duration_unit, anchor_kind, anchor_at, anchor_game_time,
           anchor_elapsed_minutes, deadline_elapsed_minutes,
           anchor_combat_instance_id, anchor_round,
           anchor_participant_kind, anchor_participant_ref,
           anchor_participant_turn_ordinal, anchor_trigger, expiry_trigger,
           dismissible, status, created_at, provenance, session_id,
           updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                 ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
      )
      .run(
        input.campaignId,
        input.effectId,
        input.kind,
        input.displayName,
        input.source.kind,
        input.source.ref ?? null,
        input.source.actor?.kind ?? null,
        input.source.actor?.ref ?? null,
        input.concentration === undefined ? 0 : 1,
        input.concentration?.owner.kind ?? null,
        input.concentration?.owner.ref ?? null,
        duration.kind,
        duration.amount,
        duration.unit,
        duration.anchorKind,
        duration.anchorAt,
        duration.anchorGameTime,
        worldAnchor,
        worldDeadline,
        duration.anchorCombatInstanceId,
        duration.anchorRound,
        duration.anchorParticipantKind,
        duration.anchorParticipantRef,
        duration.anchorParticipantTurnOrdinal,
        duration.anchorTrigger,
        duration.expiryTrigger,
        dismissible ? 1 : 0,
        input.at,
        input.provenance,
        input.sessionId,
        input.at,
      );

    for (const target of targets) {
      txnDb
        .prepare(
          `INSERT INTO active_effect_target(
             campaign_id, effect_id, target_kind, target_ref, status,
             provenance, session_id, updated_at
           )
           VALUES (?, ?, ?, ?, 'active', ?, ?, ?)`,
        )
        .run(
          input.campaignId,
          input.effectId,
          target.kind,
          target.ref,
          input.provenance,
          input.sessionId,
          input.at,
        );
    }

    const insertLink = txnDb.prepare(
      `INSERT INTO active_effect_link(
         campaign_id, effect_id, link_kind, target_kind, target_ref,
         projection_ref, campaign_actor_id, cleanup_on_end, cleanup_on_break, status,
         provenance, session_id, updated_at, natural_form_json
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
    );

    for (const projection of conditions) {
      if (projection.target.kind === 'character') {
        addCondition(txnDb, projection.condition, {
          provenance: input.provenance,
          sessionId: input.sessionId,
          at: input.at,
          characterId: projection.target.ref,
        });
      } else if (projection.target.kind === 'combatant') {
        updateCombatant(txnDb, {
          campaignId: input.campaignId,
          combatantId: projection.target.ref,
          addCondition: projection.condition,
          resolveRulesPack: input.resolveRulesPack,
          provenance: input.provenance,
          sessionId: input.sessionId,
          at: input.at,
        });
      } else {
        updateCampaignActor(txnDb, {
          campaignId: input.campaignId,
          actorId: projection.target.ref,
          removeCondition: undefined,
          addCondition: projection.condition,
          resolveRulesPack: input.resolveRulesPack,
          provenance: input.provenance,
          sessionId: input.sessionId,
          at: input.at,
        });
      }
      // Re-entrancy policy: this projection can cascade (it may break a
      // third party's concentration, whose cleanup can inactivate an actor
      // that owns THIS effect's concentration and end it mid-create). A
      // creation whose effect no longer lives cannot succeed — throw and
      // roll the whole creation back rather than committing a projection
      // ledger onto an ended effect.
      if (
        readEffectRow(txnDb, input.campaignId, input.effectId)?.status ===
        'ended'
      ) {
        throw new ActiveEffectError(
          `creating effect '${input.effectId}' was superseded: projecting ` +
            `'${projection.condition.id}' cascaded back and ended the effect ` +
            'mid-creation; nothing was committed — resolve the conflicting ' +
            'concentration topology first',
        );
      }
      insertLink.run(
        input.campaignId,
        input.effectId,
        'condition',
        projection.target.kind,
        projection.target.ref,
        projection.condition.id,
        null,
        projection.cleanupOnEnd ?? 'remove',
        projection.cleanupOnBreak ?? 'remove',
        input.provenance,
        input.sessionId,
        input.at,
        null,
      );
    }

    for (const actor of actors) {
      // The concentration replacement above may have ended a prior effect
      // that set (and on its end cleared) this creature's 0-hit-point rule;
      // the new link carries the rule again (a no-op when it still holds).
      const zeroHpRule = actorZeroHpRules.get(actor.combatantId);
      if (zeroHpRule !== undefined)
        setCombatantZeroHpRule(txnDb, {
          campaignId: input.campaignId,
          combatantId: actor.combatantId,
          rule: zeroHpRule,
          provenance: input.provenance,
          sessionId: input.sessionId,
          at: input.at,
        });
      insertLink.run(
        input.campaignId,
        input.effectId,
        'actor',
        'combatant',
        actor.combatantId,
        actor.combatantId,
        actorDurableIds.get(actor.combatantId) ?? null,
        actorPolicies.get(actor.combatantId)?.onEnd ?? 'remove',
        actorPolicies.get(actor.combatantId)?.onBreak ?? 'remove',
        input.provenance,
        input.sessionId,
        input.at,
        actor.naturalForm === undefined
          ? null
          : JSON.stringify({
              hpCurrent: actor.naturalForm.hpCurrent,
              hpMax: actor.naturalForm.hpMax,
              rulesRef: actor.naturalForm.rulesRef,
            }),
      );
    }

    for (const zone of zones) {
      txnDb
        .prepare(
          'INSERT INTO effect_spatial_zone(campaign_id,zone_id,scope_ref,shape,size_feet,provenance,session_id,updated_at) VALUES (?,?,?,?,?,?,?,?)',
        )
        .run(
          input.campaignId,
          zone.zoneId,
          zone.scopeRef,
          zone.shape,
          zone.sizeFeet,
          input.provenance,
          input.sessionId,
          input.at,
        );
      insertLink.run(
        input.campaignId,
        input.effectId,
        'zone',
        'scope',
        zone.scopeRef,
        zone.zoneId,
        null,
        zone.cleanupOnEnd ?? 'remove',
        zone.cleanupOnBreak ?? 'remove',
        input.provenance,
        input.sessionId,
        input.at,
        null,
      );
    }
    for (const form of forms) {
      txnDb
        .prepare(
          'INSERT INTO effect_transformation_form(campaign_id,target_kind,target_ref,form_ref,provenance,session_id,updated_at) VALUES (?,?,?,?,?,?,?)',
        )
        .run(
          input.campaignId,
          form.target.kind,
          form.target.ref,
          form.formRef,
          input.provenance,
          input.sessionId,
          input.at,
        );
      insertLink.run(
        input.campaignId,
        input.effectId,
        'form',
        form.target.kind,
        form.target.ref,
        form.formRef,
        null,
        form.cleanupOnEnd ?? 'remove',
        form.cleanupOnBreak ?? 'remove',
        input.provenance,
        input.sessionId,
        input.at,
        null,
      );
    }

    appendEvent(
      txnDb,
      input.campaignId,
      input.effectId,
      'created',
      {
        kind: input.kind,
        displayName: input.displayName,
        source: {
          kind: input.source.kind,
          ...(input.source.ref === undefined ? {} : { ref: input.source.ref }),
          ...(input.source.actor === undefined
            ? {}
            : { actor: { ...input.source.actor } }),
        },
        duration: durationInputForAudit(duration),
        ...(input.concentration === undefined
          ? {}
          : { concentrationOwner: { ...input.concentration.owner } }),
        targets: targets.map((target) => ({ ...target })),
        conditions: conditions.map((projection) => ({
          target: { ...projection.target },
          conditionId: projection.condition.id,
        })),
        actors: actors.map((actor) => actor.combatantId),
        zones: zones.map((zone) => ({
          zoneId: zone.zoneId,
          scopeRef: zone.scopeRef,
        })),
        forms: forms.map((form) => ({
          target: { ...form.target },
          formRef: form.formRef,
        })),
        ...(replaced === undefined
          ? {}
          : { replacedEffectId: replaced.effectId }),
      },
      input,
    );

    return {
      effect: requireEffectView(txnDb, input.campaignId, input.effectId),
      ...(replaced === undefined ? {} : { replaced }),
    };
  });
}

// ---------------------------------------------------------------------------
// endActiveEffect
// ---------------------------------------------------------------------------

export function endActiveEffect(
  db: Db,
  input: EndActiveEffectInput,
): EndActiveEffectResult {
  return withTransaction(db, (txnDb) => {
    const row = readEffectRow(txnDb, input.campaignId, input.effectId);
    if (row === undefined) {
      throw new ActiveEffectError(
        `no active effect '${input.effectId}' exists`,
      );
    }
    if (!EFFECT_END_REASONS.includes(input.reason)) {
      throw new ActiveEffectError(
        `end reason must be one of: ${EFFECT_END_REASONS.join(', ')}`,
      );
    }

    // Idempotent duplicate delivery: the same end event is a no-op; a
    // different transition on an ended effect is rejected deterministically.
    if (row.status === 'ended') {
      if (
        row.end_reason === input.reason &&
        (input.detail === undefined || row.end_detail === input.detail)
      ) {
        return {
          changed: false,
          effect: requireEffectView(txnDb, input.campaignId, input.effectId),
          cleanup: { links: [], targetsRemoved: 0 },
        };
      }
      throw new ActiveEffectError(
        `effect '${input.effectId}' already ended (${row.end_reason}` +
          `${row.end_detail === null ? '' : `:${row.end_detail}`}); it cannot end again as '${input.reason}'`,
      );
    }

    switch (input.reason) {
      case 'expired':
        validateDeclaredExpiry(txnDb, row, input.trigger);
        break;
      case 'dismissed':
        if (row.dismissible !== 1) {
          throw new ActiveEffectError(
            `effect '${input.effectId}' is not dismissible; end it by its actual rule ` +
              '(expiry, dispel, concentration break, or a noted ruling)',
          );
        }
        break;
      case 'concentration-broken': {
        if (row.requires_concentration !== 1) {
          throw new ActiveEffectError(
            `effect '${input.effectId}' is not a concentration effect`,
          );
        }
        const detail = requireNonEmptyString(
          input.detail,
          "a concentration break's detail (cause)",
        );
        if (
          !DIRECT_CONCENTRATION_BREAK_CAUSES.includes(
            detail as ConcentrationBreakCause,
          )
        ) {
          throw new ActiveEffectError(
            `concentration break cause '${detail}' is not directly declarable ` +
              `(allowed: ${DIRECT_CONCENTRATION_BREAK_CAUSES.join(', ')}); damage saves go ` +
              'through resolve_concentration, replacement through creating the new effect, ' +
              'and incapacitation/death through the HP tools',
          );
        }
        break;
      }
      case 'ruled':
        requireNonEmptyString(input.note, "a 'ruled' end's note");
        break;
      case 'dispelled':
      case 'replaced':
      case 'source-removed':
        break;
    }

    // Fresh row: read at operation start; validation performs no mutations.
    const outcome = finalizeEnd(
      txnDb,
      row,
      {
        reason: input.reason,
        ...(input.detail === undefined ? {} : { detail: input.detail }),
        ...(input.note === undefined ? {} : { note: input.note }),
        ...(input.trigger === undefined ? {} : { trigger: input.trigger }),
      },
      input,
    );
    return {
      changed: outcome.performed,
      effect: requireEffectView(txnDb, input.campaignId, input.effectId),
      cleanup: outcome.cleanup,
    };
  });
}

/**
 * Declared expiry is validated against the typed timer: an effect with no
 * natural expiry cannot 'expire'; an 'until-trigger' effect expires only by
 * naming its trigger; and a round-unit timer whose anchoring combat instance
 * is still active cannot expire before its code-evaluable deadline.
 */
function validateDeclaredExpiry(
  db: Db,
  row: ActiveEffectRow,
  trigger: string | undefined,
): void {
  if (row.status === 'active' || row.status === 'suppressed')
    validateElapsedWorldRow(row);
  if (
    row.duration_kind === 'until-dismissed' ||
    row.duration_kind === 'until-removed'
  ) {
    throw new ActiveEffectError(
      `effect '${row.effect_id}' has no natural expiry (duration: ${row.duration_kind})`,
    );
  }
  if (row.duration_kind === 'until-trigger') {
    const named = requireNonEmptyString(
      trigger,
      "expiring an 'until-trigger' effect requires naming the trigger, which",
    );
    if (named !== row.expiry_trigger) {
      throw new ActiveEffectError(
        `trigger '${named}' does not match effect '${row.effect_id}' trigger ` +
          `'${row.expiry_trigger}'`,
      );
    }
    return;
  }
  if (isParticipantTurnAnchor(row.anchor_kind)) {
    const deadline = requireParticipantTimerDeadline(
      row,
      readTargetRows(db, row.campaign_id, row.effect_id),
    );
    const instance = db
      .prepare(
        `SELECT status FROM combat_instance
         WHERE campaign_id = ? AND combat_instance_id = ?`,
      )
      .get(row.campaign_id, deadline.combatInstanceId) as
      | { status: string }
      | undefined;
    if (instance?.status === 'active') {
      const currentOrdinal = readAnchorTurnOrdinal(
        db,
        row.campaign_id,
        deadline.combatInstanceId,
        deadline.participant as {
          kind: 'character' | 'combatant';
          ref: string;
        },
      );
      if (currentOrdinal < deadline.deadlineOrdinal) {
        throw new ActiveEffectError(
          `effect '${row.effect_id}' runs until ${deadline.participant.kind} ` +
            `'${deadline.participant.ref}' turn-start ordinal ${deadline.deadlineOrdinal}; ` +
            `its current ordinal is ${currentOrdinal}, so it has not expired yet`,
        );
      }
    }
    return;
  }
  if (row.duration_unit === 'round' && row.anchor_combat_instance_id !== null) {
    const instance = db
      .prepare(
        `SELECT status, round_number FROM combat_instance
         WHERE campaign_id = ? AND combat_instance_id = ?`,
      )
      .get(row.campaign_id, row.anchor_combat_instance_id) as
      | { status: string; round_number: number }
      | undefined;
    const deadline = deadlineRound(row);
    if (
      instance !== undefined &&
      instance.status === 'active' &&
      deadline !== undefined &&
      instance.round_number < deadline
    ) {
      throw new ActiveEffectError(
        `effect '${row.effect_id}' runs until round ${deadline} and combat is in round ` +
          `${instance.round_number}; it has not expired yet`,
      );
    }
  }
  if (
    row.duration_kind === 'timed' &&
    (row.duration_unit === 'minute' ||
      row.duration_unit === 'hour' ||
      row.duration_unit === 'day')
  ) {
    if (row.deadline_elapsed_minutes === null) {
      throw new ActiveEffectError(
        `effect '${row.effect_id}' has no durable elapsed-world deadline`,
      );
    }
    const current = db
      .prepare('SELECT elapsed_minutes FROM clock WHERE id=1')
      .get() as { elapsed_minutes?: number } | undefined;
    if (current === undefined || !Number.isSafeInteger(current.elapsed_minutes))
      throw new ActiveEffectError('campaign clock is missing or malformed');
    if ((current.elapsed_minutes as number) < row.deadline_elapsed_minutes) {
      throw new ActiveEffectError(
        `effect '${row.effect_id}' runs until elapsed minute ${row.deadline_elapsed_minutes}; ` +
          `the current clock is ${current.elapsed_minutes}, so it has not expired yet`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Concentration checks & life-state reactions
// ---------------------------------------------------------------------------

/** The three d20 forms the F9 resolver produces, with their kept-die rule. */
const SAVE_DICE_FORMS: Readonly<
  Record<string, { count: number; kept: (rolls: readonly number[]) => number }>
> = {
  '1d20': { count: 1, kept: (rolls) => rolls[0] as number },
  '2d20kh1': { count: 2, kept: (rolls) => Math.max(...rolls) },
  '2d20kl1': { count: 2, kept: (rolls) => Math.min(...rolls) },
};

/**
 * Validate the save evidence for internal consistency: recognized dice form,
 * legal d20 faces, kept-die selection matching the form, and arithmetic.
 * The outcome is never part of the evidence — it is derived from the total.
 */
function validateSaveEvidence(
  save: ConcentrationSaveEvidence,
  dc: number,
): void {
  if (save.vs !== dc) {
    throw new ActiveEffectError(
      `the save was resolved against DC ${save.vs} but this damage requires ` +
        `DC ${dc} (max(10, floor(damage/2)))`,
    );
  }
  const form = SAVE_DICE_FORMS[save.dice];
  if (form === undefined) {
    throw new ActiveEffectError(
      `save dice must be one of ${Object.keys(SAVE_DICE_FORMS).join(', ')} (got '${save.dice}')`,
    );
  }
  if (
    save.rolls.length !== form.count ||
    save.rolls.some((r) => !Number.isInteger(r) || r < 1 || r > 20)
  ) {
    throw new ActiveEffectError(
      `save rolls must be ${form.count} integer(s) in [1, 20] for ${save.dice}`,
    );
  }
  if (save.natural !== form.kept(save.rolls)) {
    throw new ActiveEffectError(
      `save natural ${save.natural} does not match the ${save.dice} kept die of ` +
        `[${save.rolls.join(', ')}]`,
    );
  }
  if (
    !Number.isInteger(save.modifierTotal) ||
    !Number.isInteger(save.total) ||
    save.total !== save.natural + save.modifierTotal
  ) {
    throw new ActiveEffectError(
      `save total ${save.total} does not equal natural ${save.natural} + ` +
        `modifiers ${save.modifierTotal}`,
    );
  }
}

export function resolveConcentrationCheck(
  db: Db,
  input: ConcentrationCheckInput,
): ConcentrationCheckResult {
  return withTransaction(db, (txnDb) => {
    if (!Number.isInteger(input.damage) || input.damage < 1) {
      throw new ActiveEffectError(
        'concentration check damage must be a positive integer (the damage of the ' +
          'triggering event, before temporary-HP absorption)',
      );
    }
    const dc = concentrationSaveDc(input.damage);
    validateSaveEvidence(input.save, dc);
    // Engine-derived outcome: checks and saves have no natural auto
    // success/failure in the SRD, so the total decides.
    const outcome: 'success' | 'failure' =
      input.save.total >= dc ? 'success' : 'failure';
    const row = txnDb
      .prepare(
        `SELECT ${EFFECT_COLUMNS} FROM active_effect
         WHERE campaign_id = ? AND requires_concentration = 1
           AND concentration_owner_kind = ? AND concentration_owner_ref = ?
           AND status IN ('active', 'suppressed')`,
      )
      .get(input.campaignId, input.owner.kind, input.owner.ref) as
      | ActiveEffectRow
      | undefined;
    if (row === undefined) {
      throw new ActiveEffectError(
        `${input.owner.kind} '${input.owner.ref}' is not concentrating on anything`,
      );
    }

    appendEvent(
      txnDb,
      input.campaignId,
      row.effect_id,
      'concentration-check',
      {
        damage: input.damage,
        dc,
        dice: input.save.dice,
        rolls: [...input.save.rolls],
        natural: input.save.natural,
        modifierTotal: input.save.modifierTotal,
        total: input.save.total,
        outcome,
      },
      input,
    );

    let cleanup: EffectCleanupSummary | undefined;
    if (outcome === 'failure') {
      // Fresh row: only this check's own ledger event happened since read.
      cleanup = finalizeEnd(
        txnDb,
        row,
        { reason: 'concentration-broken', detail: 'damage-save-failed' },
        input,
      ).cleanup;
    }
    return {
      effectId: row.effect_id,
      displayName: row.display_name,
      dc,
      outcome,
      broken: outcome === 'failure',
      ...(cleanup === undefined ? {} : { cleanup }),
    };
  });
}

export interface ConcentrationBreakOnLifeEventResult {
  readonly broken: boolean;
  readonly effectId?: string;
  readonly displayName?: string;
}

/**
 * F6 life-state reaction hook: incapacitation (dying/unconscious) or death
 * breaks the character's concentration. Campaign-agnostic by owner ref, like
 * `endAllAttunementsOnDeath` — a character's concentration ends regardless of
 * which campaign row recorded it. Idempotent: no concentration, no writes.
 */
export function breakConcentrationOnLifeEvent(
  db: Db,
  ownerRef: string,
  cause: 'incapacitated' | 'dead',
  ctx: EffectMutationContext,
): ConcentrationBreakOnLifeEventResult {
  const rows = db
    .prepare(
      `SELECT ${EFFECT_COLUMNS} FROM active_effect
       WHERE requires_concentration = 1
         AND concentration_owner_kind = 'character'
         AND concentration_owner_ref = ?
         AND status IN ('active', 'suppressed')`,
    )
    .all(ownerRef) as ActiveEffectRow[];
  if (rows.length === 0) {
    return { broken: false };
  }
  // Snapshot loop (one row per campaign): a prior row's cleanup could in
  // principle cascade into a later row, so only rows whose terminal
  // transition THIS loop actually performed are reported.
  const performed = rows.filter(
    (row) =>
      finalizeEnd(
        db,
        row,
        { reason: 'concentration-broken', detail: cause },
        ctx,
      ).performed,
  );
  if (performed.length === 0) {
    return { broken: false };
  }
  return {
    broken: true,
    effectId: performed[0]?.effect_id,
    displayName: performed[0]?.display_name,
  };
}

/** The concentration effect a character owner holds, campaign-agnostic —
 *  the F6 damage path uses this to surface the required save. */
export function getCharacterConcentration(
  db: Db,
  characterId: string,
): { effectId: string; displayName: string } | undefined {
  const row = db
    .prepare(
      `SELECT effect_id, display_name FROM active_effect
       WHERE requires_concentration = 1
         AND concentration_owner_kind = 'character'
         AND concentration_owner_ref = ?
         AND status IN ('active', 'suppressed')`,
    )
    .get(characterId) as
    | { effect_id: string; display_name: string }
    | undefined;
  return row === undefined
    ? undefined
    : { effectId: row.effect_id, displayName: row.display_name };
}

/**
 * Combatant analogue of the F6 hook, called by the combatant HP path when a
 * concentrating combatant drops to 0 HP (a combatant at 0 is down/dead).
 */
export function breakCombatantConcentration(
  db: Db,
  campaignId: string,
  combatantId: string,
  cause: 'incapacitated' | 'dead' | 'owner-removed',
  ctx: EffectMutationContext,
): ConcentrationBreakOnLifeEventResult {
  const row = db
    .prepare(
      `SELECT ${EFFECT_COLUMNS} FROM active_effect
       WHERE campaign_id = ? AND requires_concentration = 1
         AND concentration_owner_kind = 'combatant'
         AND concentration_owner_ref = ?
         AND status IN ('active', 'suppressed')`,
    )
    .get(campaignId, combatantId) as ActiveEffectRow | undefined;
  if (row === undefined) {
    return { broken: false };
  }
  // Fresh row (read in this call); the primitive re-verifies regardless.
  if (
    !finalizeEnd(
      db,
      row,
      { reason: 'concentration-broken', detail: cause },
      ctx,
    ).performed
  ) {
    return { broken: false };
  }
  return {
    broken: true,
    effectId: row.effect_id,
    displayName: row.display_name,
  };
}

// ---------------------------------------------------------------------------
// Target removal, refresh, suppression, round expiry
// ---------------------------------------------------------------------------

export function removeEffectTarget(
  db: Db,
  input: RemoveEffectTargetInput,
): RemoveEffectTargetResult {
  return withTransaction(db, (txnDb) => {
    const row = readEffectRow(txnDb, input.campaignId, input.effectId);
    if (row === undefined) {
      throw new ActiveEffectError(
        `no active effect '${input.effectId}' exists`,
      );
    }
    if (row.status === 'ended') {
      throw new ActiveEffectError(
        `effect '${input.effectId}' already ended; its targets are already cleaned up`,
      );
    }
    requireNonEmptyString(input.reason, 'target removal reason');
    const target = readTargetRows(txnDb, input.campaignId, input.effectId).find(
      (candidate) =>
        candidate.target_kind === input.target.kind &&
        candidate.target_ref === input.target.ref,
    );
    if (target === undefined) {
      throw new ActiveEffectError(
        `effect '${input.effectId}' has no target ${input.target.kind}:'${input.target.ref}'`,
      );
    }
    if (target.status === 'removed') {
      if (target.removed_reason === input.reason) {
        return {
          changed: false,
          effect: requireEffectView(txnDb, input.campaignId, input.effectId),
          cleanup: [],
        };
      }
      throw new ActiveEffectError(
        `target ${input.target.kind}:'${input.target.ref}' was already removed ` +
          `(${target.removed_reason}); it cannot be removed again as '${input.reason}'`,
      );
    }

    // Re-entrancy policy (F3 mutation audit, invariant 18): mark the target
    // removed FIRST, so if a nested cleanup cascade ends this very effect
    // mid-operation, the terminal sweep (which only touches ACTIVE targets)
    // cannot overwrite this removal's provenance with 'effect-ended'.
    txnDb
      .prepare(
        `UPDATE active_effect_target
         SET status = 'removed', removed_reason = ?, removed_at = ?,
             provenance = ?, session_id = ?, updated_at = ?
         WHERE campaign_id = ? AND effect_id = ? AND target_kind = ?
           AND target_ref = ?`,
      )
      .run(
        input.reason,
        input.at,
        input.provenance,
        input.sessionId,
        input.at,
        input.campaignId,
        input.effectId,
        input.target.kind,
        input.target.ref,
      );

    // Partial multi-target cleanup: exactly this target's owned projections.
    // Each projection removal can cascade (an owned-actor removal can break
    // another owner's concentration, which can cascade back and END this
    // effect); every iteration therefore re-reads before writing and never
    // assumes the effect — or the link — is still live.
    const actions: EffectCleanupAction[] = [];
    let superseded = false;
    if (input.target.kind !== 'scope') {
      const links = readLinkRows(
        txnDb,
        input.campaignId,
        input.effectId,
      ).filter(
        (link) =>
          link.status === 'active' &&
          link.target_kind === input.target.kind &&
          link.target_ref === input.target.ref,
      );
      for (const link of links) {
        // A prior iteration's cascade may have terminally closed this link.
        const current = readLinkRows(
          txnDb,
          input.campaignId,
          input.effectId,
        ).find(
          (candidate) =>
            candidate.link_kind === link.link_kind &&
            candidate.target_kind === link.target_kind &&
            candidate.target_ref === link.target_ref &&
            candidate.projection_ref === link.projection_ref,
        );
        if (current === undefined || current.status !== 'active') {
          continue;
        }
        const action = applyLinkPolicy(
          txnDb,
          input.campaignId,
          link,
          link.cleanup_on_end,
          input,
        );
        // The cascade inside removeProjection may have ended this effect and
        // terminally closed the link; only stamp our provenance if it is
        // still ours to close — never overwrite the winning cleanup reason.
        const after = readLinkRows(
          txnDb,
          input.campaignId,
          input.effectId,
        ).find(
          (candidate) =>
            candidate.link_kind === link.link_kind &&
            candidate.target_kind === link.target_kind &&
            candidate.target_ref === link.target_ref &&
            candidate.projection_ref === link.projection_ref,
        );
        if (after !== undefined && after.status === 'active') {
          txnDb
            .prepare(
              `UPDATE active_effect_link
               SET status = ?, removed_reason = ?, removed_at = ?,
                   provenance = ?, session_id = ?, updated_at = ?
               WHERE campaign_id = ? AND effect_id = ? AND link_kind = ?
                 AND target_kind = ? AND target_ref = ? AND projection_ref = ?`,
            )
            .run(
              action === 'released' ? 'released' : 'removed',
              `target-removed:${input.reason}`,
              input.at,
              input.provenance,
              input.sessionId,
              input.at,
              input.campaignId,
              input.effectId,
              link.link_kind,
              link.target_kind,
              link.target_ref,
              link.projection_ref,
            );
          actions.push({
            linkKind: link.link_kind,
            target: { kind: link.target_kind, ref: link.target_ref },
            projectionRef: link.projection_ref,
            action,
          });
        }
        const liveNow = readEffectRow(txnDb, input.campaignId, input.effectId);
        if (liveNow?.status === 'ended') {
          superseded = true;
          break;
        }
      }
    }

    // 'ended' is the final ledger event: when a cascade ended this effect,
    // the terminal event already closed the ledger and no 'target-removed'
    // event may follow it. The target row's 'saved'/'ruled' provenance and
    // the terminal event's cleanup record remain the durable evidence.
    if (!superseded) {
      appendEvent(
        txnDb,
        input.campaignId,
        input.effectId,
        'target-removed',
        {
          target: { ...input.target },
          reason: input.reason,
          cleanup: actions.map((action) => ({
            linkKind: action.linkKind,
            targetKind: action.target.kind,
            targetRef: action.target.ref,
            projectionRef: action.projectionRef,
            action: action.action,
          })),
        },
        input,
      );
    }

    return {
      changed: true,
      ...(superseded ? { superseded: true } : {}),
      effect: requireEffectView(txnDb, input.campaignId, input.effectId),
      cleanup: actions,
    };
  });
}

interface BondedRecastTransition {
  readonly id: string;
  /** The modelled presence the transition applies from. */
  readonly from: 'absent' | 'present' | 'pocket-dimension';
  readonly operation: 'restore-same-actor' | 'select-new-form';
  readonly forms: readonly string[];
}

/** The presence a bonded actor's status stands for (eshyra-82uk). */
function bondedPresence(
  status: string,
): 'absent' | 'present' | 'pocket-dimension' | undefined {
  return status === 'absent'
    ? 'absent'
    : status === 'alive'
      ? 'present'
      : status === 'pocketed'
        ? 'pocket-dimension'
        : undefined;
}

const asObject = (v: unknown): Record<string, unknown> | undefined =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;

const axisIncludes = (v: unknown, value: string): boolean =>
  v === value || (Array.isArray(v) && v.includes(value));

/** The spell record's cast-again transition for a creature whose link is still
 *  active and whose modelled presence is `from`. From 'absent' it must restore
 *  presence (presence -> present); from 'present' or 'pocket-dimension' it
 *  must change no presence.
 *  Its operation, never the spell's name, decides what a recast does. */
function findBondedRecastTransition(
  record: RulesRecord,
  from: 'absent' | 'present' | 'pocket-dimension',
):
  | { transition: BondedRecastTransition }
  | { unsupportedOperation: string }
  | undefined {
  const mechanics = asObject(asObject(record.data)?.mechanics);
  const effects = Array.isArray(mechanics?.effects) ? mechanics.effects : [];
  for (const rawEffect of effects) {
    const effect = asObject(rawEffect);
    const transitions = Array.isArray(effect?.transitions)
      ? effect.transitions
      : [];
    for (const rawTransition of transitions) {
      const t = asObject(rawTransition);
      const when = asObject(t?.when);
      if (
        t === undefined ||
        t.trigger !== 'cast-again' ||
        !axisIncludes(when?.presence, from) ||
        !axisIncludes(when?.link, 'active')
      )
        continue;
      const presenceChanges = (Array.isArray(t.changes) ? t.changes : [])
        .map(asObject)
        .filter((c) => c?.axis === 'presence');
      // Absent: the recast must restore presence. Present: it changes none.
      if (
        from === 'absent'
          ? !presenceChanges.some((c) => c?.to === 'present')
          : presenceChanges.length > 0
      )
        continue;
      const kind = asObject(t.operation)?.kind;
      const rawForms = asObject(effect?.creation)?.forms;
      const forms = (Array.isArray(rawForms) ? rawForms : [])
        .map((f: unknown) => asObject(f)?.creatureRef)
        .filter((r): r is string => typeof r === 'string');
      if (kind === 'select-new-form') {
        return {
          transition: {
            id: String(t.id ?? 'cast-again'),
            from,
            operation: 'select-new-form',
            forms,
          },
        };
      }
      if (
        from === 'absent' &&
        kind === 'restore-same-actor' &&
        asObject(t.operation)?.hitPoints === 'maximum'
      ) {
        return {
          transition: {
            id: String(t.id ?? 'cast-again'),
            from,
            operation: 'restore-same-actor',
            forms,
          },
        };
      }
      return {
        unsupportedOperation: typeof kind === 'string' ? kind : 'no operation',
      };
    }
  }
  return undefined;
}

/**
 * recast_bonded_summon (eshyra-s02z): the source recast of a bonded summon
 * restores its absent creature, or reforms a present one (eshyra-71u1). The
 * effect keeps its active link to a campaign actor; the actor's modelled
 * presence (absent -> 'absent', alive -> 'present') selects the spell record's
 * cast-again transition. From absent (link active, presence -> present):
 * restore-same-actor at maximum hit points (Find Steed), or select-new-form
 * (Find Familiar: the creature returns in a form chosen from the record's
 * creation forms, with that creature record's hit points). From present (link
 * active, no presence change): only select-new-form (Find Familiar reforms the
 * same actor); a spell with no such transition (Find Steed) is refused.
 * Validated before any write; spends no spell slot.
 */
export function recastBondedSummon(
  db: Db,
  input: RecastBondedSummonInput,
): RecastBondedSummonResult {
  return withTransaction(db, (txnDb) => {
    const row = readEffectRow(txnDb, input.campaignId, input.effectId);
    if (row === undefined)
      throw new ActiveEffectError(
        `no active effect '${input.effectId}' exists`,
      );
    if (row.status === 'ended')
      throw new ActiveEffectError(
        `effect '${input.effectId}' has ended; with no bond a new cast creates a new creature (start_effect, then start_encounter), never a recast`,
      );
    if (row.status !== 'active')
      throw new ActiveEffectError(
        `effect '${input.effectId}' is suppressed; a recast needs an active bond (unsuppress it first)`,
      );
    if (row.kind !== 'summoning')
      throw new ActiveEffectError(
        `effect '${input.effectId}' is a ${row.kind} effect; recast_bonded_summon applies only to a summoning effect`,
      );
    if (row.source_kind !== 'spell')
      throw new ActiveEffectError(
        `effect '${input.effectId}' was not recorded from its spell (source kind '${row.source_kind}'), so the engine cannot tell which spell created the bond; a recast applies only to a bond created with start_effect source { kind: 'spell', ref }`,
      );
    if (row.source_ref !== input.spellRef)
      throw new ActiveEffectError(
        `effect '${input.effectId}' was cast from '${row.source_ref ?? 'no spell'}', not '${input.spellRef}'`,
      );
    const record = lookupCampaignRecord(
      txnDb,
      'spell',
      input.spellRef,
      input.resolveRulesPack,
    );
    if (record === undefined)
      throw new ActiveEffectError(
        `no spell record '${input.spellRef}' resolves in this campaign's rules`,
      );
    const activeLinks = readLinkRows(
      txnDb,
      input.campaignId,
      input.effectId,
    ).filter((link) => link.link_kind === 'actor' && link.status === 'active');
    const link = activeLinks[0];
    if (link === undefined)
      throw new ActiveEffectError(
        `effect '${input.effectId}' holds no active actor link (it was released or its creature is gone); with no bond a new cast creates a new creature (start_effect, then start_encounter), never a recast`,
      );
    if (activeLinks.length !== 1)
      throw new ActiveEffectError(
        `effect '${input.effectId}' holds ${activeLinks.length} active actor links; a bonded recast needs exactly one`,
      );
    if (link.campaign_actor_id === null)
      throw new ActiveEffectError(
        `effect '${input.effectId}' links an encounter-only creature with no durable campaign actor; only a durable bonded creature can be recast`,
      );
    const bondedActor = getCampaignActor(
      txnDb,
      input.campaignId,
      link.campaign_actor_id,
    );
    if (bondedActor === undefined)
      throw new ActiveEffectError(
        `effect '${input.effectId}' links campaign actor '${link.campaign_actor_id}', which does not exist`,
      );
    // The engine models three presences: absent (vanished at 0 HP or
    // dismissed), present, and pocket-dimension (eshyra-82uk).
    const presence = bondedPresence(bondedActor.status);
    if (presence === undefined)
      throw new ActiveEffectError(
        `campaign actor '${bondedActor.actorId}' is ${bondedActor.status}, which is not absent, present or in its pocket dimension; a recast cannot reason about that presence`,
      );
    const found = findBondedRecastTransition(record, presence);
    if (found === undefined)
      throw new ActiveEffectError(
        presence === 'absent'
          ? `spell '${record.name}' has no cast-again transition that restores an absent creature whose link is active; recast_bonded_summon does not apply`
          : `spell '${record.name}' has no cast-again transition for a ${presence === 'present' ? 'present' : 'pocketed'} creature whose link is active; recast_bonded_summon does not apply`,
      );
    if ('unsupportedOperation' in found)
      throw new ActiveEffectError(
        `spell '${record.name}' recasts a${presence === 'absent' ? 'n absent' : presence === 'present' ? ' present' : ' pocketed'} creature with operation '${found.unsupportedOperation}', which the engine cannot execute`,
      );
    const { transition } = found;
    if (transition.operation === 'restore-same-actor') {
      if (input.form !== undefined)
        throw new ActiveEffectError(
          `'${record.name}' restores the same creature; it takes no form`,
        );
    } else if (input.form === undefined) {
      throw new ActiveEffectError(
        `'${record.name}' lets the creature adopt a form on its return: pass form as one of ${transition.forms.join(', ')}`,
      );
    } else if (!transition.forms.includes(input.form)) {
      throw new ActiveEffectError(
        `form '${input.form}' is not one of the forms '${record.name}' lists: ${transition.forms.join(', ')}`,
      );
    }
    let restored: ReturnType<typeof restoreBondedCampaignActor>;
    try {
      restored = restoreBondedCampaignActor(txnDb, {
        campaignId: input.campaignId,
        actorId: link.campaign_actor_id,
        expectedPresence: transition.from,
        restore:
          transition.operation === 'select-new-form' && input.form !== undefined
            ? { kind: 'new-form', rulesRef: input.form }
            : { kind: 'maximum' },
        ...(input.resolveRulesPack === undefined
          ? {}
          : { resolveRulesPack: input.resolveRulesPack }),
        provenance: input.provenance,
        sessionId: input.sessionId,
        at: input.at,
      });
    } catch (e) {
      if (e instanceof EncounterCombatantError)
        throw new ActiveEffectError(e.message);
      throw e;
    }
    appendEvent(
      txnDb,
      input.campaignId,
      input.effectId,
      'recast',
      {
        spellRef: input.spellRef,
        transitionId: transition.id,
        actor: link.campaign_actor_id,
        hpCurrent: restored.hpCurrent,
        hpMax: restored.hpMax,
        ...(input.form === undefined ? {} : { form: input.form }),
      },
      input,
    );
    return {
      effect: requireEffectView(txnDb, input.campaignId, input.effectId),
      spellRef: input.spellRef,
      transitionId: transition.id,
      actorId: link.campaign_actor_id,
      rulesRef: restored.rulesRef,
      hpCurrent: restored.hpCurrent,
      hpMax: restored.hpMax,
      ...(input.form === undefined ? {} : { form: input.form }),
    };
  });
}

interface BondedPresenceTransition {
  readonly id: string;
  readonly presenceTo: string | undefined;
  readonly linkTo: string | undefined;
  readonly operation: { kind: string; withinFeet?: number } | undefined;
}

/** The record transition for an action trigger, its current presence and an
 *  active link. 'gated' carries the ambiguity id of an availability gate. */
function findBondedActionTransition(
  record: RulesRecord,
  trigger: string,
  presence: string,
):
  | { transition: BondedPresenceTransition }
  | { gated: string }
  | { unsupported: string }
  | undefined {
  const mechanics = asObject(asObject(record.data)?.mechanics);
  const effects = Array.isArray(mechanics?.effects) ? mechanics.effects : [];
  for (const rawEffect of effects) {
    const effect = asObject(rawEffect);
    if (effect?.kind !== 'summoning') continue;
    const transitions = Array.isArray(effect.transitions)
      ? effect.transitions
      : [];
    for (const rawTransition of transitions) {
      const t = asObject(rawTransition);
      const when = asObject(t?.when);
      if (
        t === undefined ||
        t.trigger !== trigger ||
        !axisIncludes(when?.presence, presence) ||
        !axisIncludes(when?.link, 'active')
      )
        continue;
      const id = String(t.id ?? trigger);
      const availability = asObject(t.availability);
      if (availability !== undefined) {
        if (
          availability.kind === 'source-ambiguity' &&
          typeof availability.ambiguityId === 'string'
        )
          return { gated: availability.ambiguityId };
        return {
          unsupported: `transition '${id}' has an availability gate of kind '${String(availability.kind)}'`,
        };
      }
      const changes = (Array.isArray(t.changes) ? t.changes : []).map(asObject);
      const other = changes.find(
        (c) => c?.axis !== 'presence' && c?.axis !== 'link',
      );
      if (other !== undefined)
        return {
          unsupported: `transition '${id}' changes '${String(other.axis)}', which the engine does not execute here`,
        };
      const presenceTo = changes.find((c) => c?.axis === 'presence')?.to;
      const linkTo = changes.find((c) => c?.axis === 'link')?.to;
      const operation = asObject(t.operation);
      if (
        operation !== undefined &&
        operation.kind !== 'place-in-unoccupied-space'
      )
        return {
          unsupported: `transition '${id}' has operation '${String(operation.kind)}', which the engine does not execute`,
        };
      return {
        transition: {
          id,
          presenceTo: typeof presenceTo === 'string' ? presenceTo : undefined,
          linkTo: typeof linkTo === 'string' ? linkTo : undefined,
          operation:
            operation === undefined
              ? undefined
              : {
                  kind: String(operation.kind),
                  ...(typeof operation.withinFeet === 'number'
                    ? { withinFeet: operation.withinFeet }
                    : {}),
                },
        },
      };
    }
  }
  return undefined;
}

/**
 * transition_bonded_summon (eshyra-82uk): executes an action-triggered
 * presence transition declared by a bonded summon's spell record (Find
 * Familiar: temporary dismissal to the pocket dimension, recall, permanent
 * dismissal; Find Steed: dismissal, release). The transition is selected by
 * trigger, the creature's modelled presence (alive -> present, pocketed ->
 * pocket-dimension, absent -> absent) and an active link, never by spell
 * name, and executed by its declared changes:
 *  - presence present -> pocket-dimension: the creature (and its combatant,
 *    when in combat) leaves play; the actor is pocketed with its hit points
 *    and conditions;
 *  - presence pocket-dimension -> present: the actor returns alive and, when
 *    a combat instance is active, enters it as a NEW combatant row;
 *  - presence present -> absent, link unchanged: the creature leaves play
 *    (absent) and stays bonded; a later cast restores it;
 *  - link -> none (presence absent): the creature leaves play, the link is
 *    closed, and the effect ends ('dismissed') when it owned nothing else.
 * Validated before any write (the whole call is one transaction); spends no
 * action.
 */
export function transitionBondedSummon(
  db: Db,
  input: TransitionBondedSummonInput,
): TransitionBondedSummonResult {
  return withTransaction(db, (txnDb) => {
    if (!BONDED_SUMMON_TRIGGERS.includes(input.trigger))
      throw new ActiveEffectError(
        `unknown trigger '${input.trigger}'; expected one of: ${BONDED_SUMMON_TRIGGERS.join(', ')}`,
      );
    const row = readEffectRow(txnDb, input.campaignId, input.effectId);
    if (row === undefined)
      throw new ActiveEffectError(
        `no active effect '${input.effectId}' exists`,
      );
    if (row.status === 'ended')
      throw new ActiveEffectError(
        `effect '${input.effectId}' has ended; a dismissed or released creature returns only as a new creature from a new cast (start_effect, then start_encounter)`,
      );
    if (row.status !== 'active')
      throw new ActiveEffectError(
        `effect '${input.effectId}' is suppressed; a presence transition needs an active bond (unsuppress it first)`,
      );
    if (row.kind !== 'summoning')
      throw new ActiveEffectError(
        `effect '${input.effectId}' is a ${row.kind} effect; transition_bonded_summon applies only to a summoning effect`,
      );
    if (row.source_kind !== 'spell')
      throw new ActiveEffectError(
        `effect '${input.effectId}' was not recorded from its spell (source kind '${row.source_kind}'), so the engine cannot tell which spell created the bond; a presence transition applies only to a bond created with start_effect source { kind: 'spell', ref }`,
      );
    if (row.source_ref !== input.spellRef)
      throw new ActiveEffectError(
        `effect '${input.effectId}' was cast from '${row.source_ref ?? 'no spell'}', not '${input.spellRef}'`,
      );
    const record = lookupCampaignRecord(
      txnDb,
      'spell',
      input.spellRef,
      input.resolveRulesPack,
    );
    if (record === undefined)
      throw new ActiveEffectError(
        `no spell record '${input.spellRef}' resolves in this campaign's rules`,
      );
    const activeLinks = readLinkRows(
      txnDb,
      input.campaignId,
      input.effectId,
    ).filter((link) => link.link_kind === 'actor' && link.status === 'active');
    const link = activeLinks[0];
    if (link === undefined)
      throw new ActiveEffectError(
        `effect '${input.effectId}' holds no active actor link (it was released or its creature is gone); a released or dismissed creature returns only as a new creature from a new cast`,
      );
    if (activeLinks.length !== 1)
      throw new ActiveEffectError(
        `effect '${input.effectId}' holds ${activeLinks.length} active actor links; a bonded transition needs exactly one`,
      );
    const actorId = link.campaign_actor_id;
    if (actorId === null)
      throw new ActiveEffectError(
        `effect '${input.effectId}' links an encounter-only creature with no durable campaign actor; only a durable bonded creature can change presence`,
      );
    const actor = getCampaignActor(txnDb, input.campaignId, actorId);
    if (actor === undefined)
      throw new ActiveEffectError(
        `effect '${input.effectId}' links campaign actor '${actorId}', which does not exist`,
      );
    if (asObject(actor.state.combatLifecycle)?.zeroHpRule !== 'vanish-bonded')
      throw new ActiveEffectError(
        `campaign actor '${actorId}' does not have the 'vanish-bonded' zero-hit-point rule; presence transitions apply only to a bonded familiar or steed`,
      );
    const presence = bondedPresence(actor.status);
    if (presence === undefined)
      throw new ActiveEffectError(
        `campaign actor '${actorId}' is ${actor.status}, which is not absent, present or in its pocket dimension; a presence transition cannot reason about that presence`,
      );
    const found = findBondedActionTransition(record, input.trigger, presence);
    if (found === undefined)
      throw new ActiveEffectError(
        `spell '${record.name}' has no ${input.trigger} transition for a creature that is ${presence === 'pocket-dimension' ? 'in its pocket dimension' : presence} with its link active`,
      );
    if ('gated' in found)
      throw new ActiveEffectError(
        `spell '${record.name}' ${input.trigger} from ${presence} is gated by an unresolved source ambiguity (${found.gated}); the engine does not execute it`,
      );
    if ('unsupported' in found)
      throw new ActiveEffectError(
        `spell '${record.name}': ${found.unsupported}`,
      );
    const { transition } = found;
    const presenceTo = transition.presenceTo ?? presence;
    const linkTo = transition.linkTo ?? 'active';
    let kind: 'pocket' | 'recall' | 'dismiss' | 'release';
    if (linkTo === 'none' && presenceTo === 'absent') kind = 'release';
    else if (linkTo !== 'active')
      throw new ActiveEffectError(
        `spell '${record.name}' transition '${transition.id}' sets the link to '${linkTo}', which the engine does not execute`,
      );
    else if (presence === 'present' && presenceTo === 'pocket-dimension')
      kind = 'pocket';
    else if (presence === 'pocket-dimension' && presenceTo === 'present')
      kind = 'recall';
    else if (presence === 'present' && presenceTo === 'absent')
      kind = 'dismiss';
    else
      throw new ActiveEffectError(
        `spell '${record.name}' transition '${transition.id}' moves presence ${presence} -> ${presenceTo}, which the engine does not execute`,
      );
    if (kind !== 'recall' && transition.operation !== undefined)
      throw new ActiveEffectError(
        `spell '${record.name}' transition '${transition.id}' carries operation '${transition.operation.kind}' the engine does not execute for this change`,
      );

    // ---- execution: every check above passed ----
    const ctx = {
      provenance: input.provenance,
      sessionId: input.sessionId,
      at: input.at,
      ...(input.resolveRulesPack === undefined
        ? {}
        : { resolveRulesPack: input.resolveRulesPack }),
    };
    let combatantLeft: string | undefined;
    let combatantEntered: string | undefined;
    try {
      if (kind === 'recall') {
        combatantEntered = recallPocketedCampaignActor(txnDb, {
          campaignId: input.campaignId,
          actorId,
          ...(input.side === undefined ? {} : { side: input.side }),
          ...(input.faction === undefined ? {} : { faction: input.faction }),
          ...(input.placement === undefined
            ? {}
            : { placement: input.placement }),
          ...ctx,
        }).combatantEntered;
      } else {
        // A creature leaving a combat instance keeps its references: its
        // links/targets/source refs move onto the durable actor first, the
        // same rebinding combat closure applies.
        const live = findLiveActorCombatantId(txnDb, input.campaignId, actorId);
        if (live !== undefined) {
          const instanceId = (
            txnDb
              .prepare(
                `SELECT combat_instance_id FROM encounter_combatant
                 WHERE campaign_id = ? AND combatant_id = ?`,
              )
              .get(input.campaignId, live) as { combat_instance_id: string }
          ).combat_instance_id;
          rebindCombatantReferencesToActor(
            txnDb,
            input.campaignId,
            live,
            actorId,
            instanceId,
            ctx,
            new Map(),
            {
              actorsRebound: 0,
              sourceActorsRebound: 0,
              targetsRebound: 0,
              linksRebound: 0,
            },
          );
        }
        combatantLeft = moveBondedCreatureOutOfPlay(txnDb, {
          campaignId: input.campaignId,
          actorId,
          to: kind === 'pocket' ? 'pocketed' : 'absent',
          ...ctx,
        }).combatantLeft;
      }
    } catch (e) {
      if (e instanceof EncounterCombatantError)
        throw new ActiveEffectError(e.message);
      throw e;
    }
    if (kind === 'release') {
      // Re-read: the combatant rebind above may have moved the link.
      const held = readLinkRows(txnDb, input.campaignId, input.effectId).find(
        (l) => l.link_kind === 'actor' && l.status === 'active',
      );
      if (held === undefined)
        throw new ActiveEffectError(
          `effect '${input.effectId}' lost its actor link during the transition`,
        );
      txnDb
        .prepare(
          `UPDATE active_effect_link
           SET status = 'removed', removed_reason = ?, removed_at = ?,
               provenance = ?, session_id = ?, updated_at = ?
           WHERE campaign_id = ? AND effect_id = ? AND link_kind = ?
             AND target_kind = ? AND target_ref = ? AND projection_ref = ?`,
        )
        .run(
          `bond-ended:${transition.id}`,
          input.at,
          input.provenance,
          input.sessionId,
          input.at,
          input.campaignId,
          input.effectId,
          held.link_kind,
          held.target_kind,
          held.target_ref,
          held.projection_ref,
        );
      txnDb
        .prepare(
          `UPDATE active_effect_target
           SET status = 'removed', removed_reason = ?, removed_at = ?,
               provenance = ?, session_id = ?, updated_at = ?
           WHERE campaign_id = ? AND effect_id = ? AND status = 'active'
             AND target_kind = ? AND target_ref = ?`,
        )
        .run(
          `bond-ended:${transition.id}`,
          input.at,
          input.provenance,
          input.sessionId,
          input.at,
          input.campaignId,
          input.effectId,
          held.target_kind,
          held.target_ref,
        );
    }
    const narratedPlacement =
      kind === 'recall' ? transition.operation : undefined;
    appendEvent(
      txnDb,
      input.campaignId,
      input.effectId,
      'presence-transition',
      {
        spellRef: input.spellRef,
        transitionId: transition.id,
        trigger: input.trigger,
        actor: actorId,
        from: { presence, link: 'active' },
        to: { presence: presenceTo, link: linkTo },
        ...(combatantLeft === undefined ? {} : { combatantLeft }),
        ...(combatantEntered === undefined ? {} : { combatantEntered }),
      },
      input,
    );
    let effectEnded = false;
    if (kind === 'release') {
      const ownsMore = readLinkRows(
        txnDb,
        input.campaignId,
        input.effectId,
      ).some((l) => l.link_kind === 'actor' && l.status === 'active');
      if (!ownsMore) {
        const live = readEffectRow(txnDb, input.campaignId, input.effectId);
        if (live !== undefined && live.status !== 'ended')
          effectEnded = finalizeEnd(
            txnDb,
            live,
            {
              reason: 'dismissed',
              detail: input.trigger,
              note: `its last owned creature '${actorId}' was ${input.trigger === 'action-release' ? 'released from its bond' : 'dismissed forever'}`,
            },
            input,
          ).performed;
      }
    }
    return {
      effect: requireEffectView(txnDb, input.campaignId, input.effectId),
      spellRef: input.spellRef,
      transitionId: transition.id,
      trigger: input.trigger,
      actorId,
      from: { presence, link: 'active' },
      to: { presence: presenceTo, link: linkTo as 'active' | 'none' },
      ...(combatantLeft === undefined ? {} : { combatantLeft }),
      ...(combatantEntered === undefined ? {} : { combatantEntered }),
      effectEnded,
      ...(narratedPlacement === undefined ? {} : { narratedPlacement }),
    };
  });
}

export function refreshEffect(
  db: Db,
  input: RefreshEffectInput,
): ActiveEffectView {
  return withTransaction(db, (txnDb) => {
    const row = readEffectRow(txnDb, input.campaignId, input.effectId);
    if (row === undefined) {
      throw new ActiveEffectError(
        `no active effect '${input.effectId}' exists`,
      );
    }
    if (row.status !== 'active') {
      throw new ActiveEffectError(
        row.status === 'ended'
          ? `effect '${input.effectId}' has ended; a rule that re-establishes it creates a ` +
              'new effect, it never refreshes the old one'
          : `effect '${input.effectId}' is suppressed; unsuppress it before refreshing`,
      );
    }
    const durationInput: EffectDurationInput =
      input.duration ??
      (row.duration_kind === 'timed'
        ? {
            kind: 'timed',
            // Row is CHECK-validated: a timed row carries all three fields.
            amount: row.duration_amount as number,
            unit: row.duration_unit as EffectDurationUnit,
            anchor: row.anchor_kind as EffectAnchorKind,
            ...(row.anchor_trigger === null
              ? {}
              : { anchorTrigger: row.anchor_trigger }),
          }
        : row.duration_kind === 'until-trigger'
          ? {
              kind: 'until-trigger',
              trigger: row.expiry_trigger as string,
            }
          : { kind: row.duration_kind });
    const duration = validateDuration(
      txnDb,
      input.campaignId,
      durationInput,
      row.dismissible === 1,
      row.source_kind,
      input,
      row.source_actor_kind === null || row.source_actor_ref === null
        ? undefined
        : { kind: row.source_actor_kind, ref: row.source_actor_ref },
      readTargetRows(txnDb, input.campaignId, input.effectId).map((target) => ({
        kind: target.target_kind,
        ref: target.target_ref,
      })),
    );
    // A refreshed duration is grounded the same way a created one is: a
    // spell record's parseable duration binds the refresh too.
    if (
      input.duration !== undefined &&
      row.source_kind === 'spell' &&
      row.source_ref !== null
    ) {
      const record = lookupCampaignRecord(
        txnDb,
        'spell',
        row.source_ref,
        input.resolveRulesPack,
      );
      const durationText = (record?.data as Record<string, unknown> | undefined)
        ?.duration;
      if (typeof durationText === 'string') {
        const parsed = parseSpellDurationText(durationText).form;
        if (
          parsed.kind === 'timed' &&
          (duration.kind !== 'timed' ||
            duration.amount !== parsed.amount ||
            duration.unit !== parsed.unit)
        ) {
          throw new ActiveEffectError(
            `the spell record's duration is ${parsed.amount} ${parsed.unit}(s); a refresh ` +
              'must re-anchor that duration, not declare a different one',
          );
        }
      }
    }

    const { anchor: worldAnchor, deadline: worldDeadline } =
      elapsedWorldDeadline(txnDb, duration);
    const previous = durationView(row);
    txnDb
      .prepare(
        `UPDATE active_effect
         SET duration_kind = ?, duration_amount = ?, duration_unit = ?,
             anchor_kind = ?, anchor_at = ?, anchor_game_time = ?,
             anchor_elapsed_minutes = ?, deadline_elapsed_minutes = ?,
             anchor_combat_instance_id = ?, anchor_round = ?,
             anchor_participant_kind = ?, anchor_participant_ref = ?,
             anchor_participant_turn_ordinal = ?, anchor_trigger = ?,
             expiry_trigger = ?, provenance = ?, session_id = ?,
             updated_at = ?
         WHERE campaign_id = ? AND effect_id = ?`,
      )
      .run(
        duration.kind,
        duration.amount,
        duration.unit,
        duration.anchorKind,
        duration.anchorAt,
        duration.anchorGameTime,
        worldAnchor,
        worldDeadline,
        duration.anchorCombatInstanceId,
        duration.anchorRound,
        duration.anchorParticipantKind,
        duration.anchorParticipantRef,
        duration.anchorParticipantTurnOrdinal,
        duration.anchorTrigger,
        duration.expiryTrigger,
        input.provenance,
        input.sessionId,
        input.at,
        input.campaignId,
        input.effectId,
      );
    appendEvent(
      txnDb,
      input.campaignId,
      input.effectId,
      'refreshed',
      {
        previous: previous as unknown as Record<string, unknown>,
        next: durationInputForAudit(duration),
        ...(input.note === undefined ? {} : { note: input.note }),
      },
      input,
    );
    return requireEffectView(txnDb, input.campaignId, input.effectId);
  });
}

export function suppressEffect(
  db: Db,
  input: SuppressEffectInput,
): ActiveEffectView {
  return withTransaction(db, (txnDb) => {
    const row = readEffectRow(txnDb, input.campaignId, input.effectId);
    if (row === undefined) {
      throw new ActiveEffectError(
        `no active effect '${input.effectId}' exists`,
      );
    }
    if (row.status !== 'active') {
      throw new ActiveEffectError(
        `only an active effect can be suppressed (status: ${row.status})`,
      );
    }
    txnDb
      .prepare(
        `UPDATE active_effect
         SET status = 'suppressed', provenance = ?, session_id = ?,
             updated_at = ?
         WHERE campaign_id = ? AND effect_id = ?`,
      )
      .run(
        input.provenance,
        input.sessionId,
        input.at,
        input.campaignId,
        input.effectId,
      );
    appendEvent(
      txnDb,
      input.campaignId,
      input.effectId,
      'suppressed',
      input.note === undefined ? {} : { note: input.note },
      input,
    );
    return requireEffectView(txnDb, input.campaignId, input.effectId);
  });
}

export function unsuppressEffect(
  db: Db,
  input: SuppressEffectInput,
): ActiveEffectView {
  return withTransaction(db, (txnDb) => {
    const row = readEffectRow(txnDb, input.campaignId, input.effectId);
    if (row === undefined) {
      throw new ActiveEffectError(
        `no active effect '${input.effectId}' exists`,
      );
    }
    if (row.status !== 'suppressed') {
      throw new ActiveEffectError(
        `only a suppressed effect can be unsuppressed (status: ${row.status})`,
      );
    }
    txnDb
      .prepare(
        `UPDATE active_effect
         SET status = 'active', provenance = ?, session_id = ?, updated_at = ?
         WHERE campaign_id = ? AND effect_id = ?`,
      )
      .run(
        input.provenance,
        input.sessionId,
        input.at,
        input.campaignId,
        input.effectId,
      );
    appendEvent(
      txnDb,
      input.campaignId,
      input.effectId,
      'unsuppressed',
      input.note === undefined ? {} : { note: input.note },
      input,
    );
    return requireEffectView(txnDb, input.campaignId, input.effectId);
  });
}

/** One-line prompt/CLI rendering of a live effect, e.g.
 *  `fx-bless: Bless [active] (spell-effect, spell:bless) — concentration:
 *   character pc-1 — 1 minute(s) from spell-cast — targets: character pc-1 —
 *   owns: condition 'blessed' on character pc-1`. */
export function formatActiveEffect(effect: ActiveEffectView): string {
  const source =
    effect.source.ref === undefined
      ? effect.source.kind
      : `${effect.source.kind} ${effect.source.ref}`;
  const parts = [
    `${effect.effectId}: ${effect.displayName} [${effect.status}] (${effect.kind}, ${source})`,
  ];
  if (effect.concentrationOwner !== undefined) {
    parts.push(
      `concentration: ${effect.concentrationOwner.kind} ${effect.concentrationOwner.ref}`,
    );
  }
  const d = effect.duration;
  if (d.kind === 'timed') {
    const rounds =
      d.deadlineRound === undefined
        ? ''
        : ` (expires at combat round ${d.deadlineRound})`;
    const participantClock =
      d.anchorParticipant === undefined
        ? ''
        : ` [clock: ${d.anchorParticipant.kind} ${d.anchorParticipant.ref}, ` +
          `turn ${d.anchorParticipantTurnOrdinal}→${d.deadlineParticipantTurnOrdinal}]`;
    const trigger =
      d.anchorTrigger === undefined ? '' : ` [trigger: ${d.anchorTrigger}]`;
    parts.push(
      `${d.amount} ${d.unit}(s) from ${d.anchorKind}${rounds}${participantClock}${trigger}`,
    );
  } else if (d.kind === 'until-trigger') {
    parts.push(`until trigger: ${d.trigger}`);
  } else {
    parts.push(d.kind);
  }
  if (effect.dismissible) {
    parts.push('dismissible');
  }
  const activeTargets = effect.targets.filter(
    (target) => target.status === 'active',
  );
  if (activeTargets.length > 0) {
    parts.push(
      `targets: ${activeTargets
        .map((target) => `${target.kind} ${target.ref}`)
        .join(', ')}`,
    );
  }
  const activeLinks = effect.links.filter((link) => link.status === 'active');
  if (activeLinks.length > 0) {
    parts.push(
      `owns: ${activeLinks
        .map(
          (link) =>
            `${link.linkKind} '${link.projectionRef}' on ${link.target.kind} ${link.target.ref}`,
        )
        .join(', ')}`,
    );
  }
  return parts.join(' — ');
}

export interface ExpiredWorldEffectSummary {
  readonly effectId: string;
  readonly displayName: string;
  readonly deadlineElapsedMinutes: number;
  readonly cleanup: EffectCleanupSummary;
}
export interface ExpiredRoundEffectSummary {
  readonly effectId: string;
  readonly displayName: string;
  readonly deadlineRound: number;
  readonly cleanup: EffectCleanupSummary;
}

/** Expire minute/hour/day effects against the monotonic campaign timeline. */
export function expireElapsedWorldEffects(
  db: Db,
  input: EffectMutationContext & { campaignId: string; elapsedMinutes: number },
): ExpiredWorldEffectSummary[] {
  return withTransaction(db, (txnDb) => {
    if (!Number.isSafeInteger(input.elapsedMinutes) || input.elapsedMinutes < 0)
      throw new ActiveEffectError(
        'elapsed world time must be a nonnegative safe integer',
      );
    const rows = txnDb
      .prepare(
        `SELECT ${EFFECT_COLUMNS} FROM active_effect WHERE campaign_id=? AND status IN ('active','suppressed') ORDER BY COALESCE(deadline_elapsed_minutes, 9223372036854775807), created_at, effect_id`,
      )
      .all(input.campaignId) as ActiveEffectRow[];
    const expired: ExpiredWorldEffectSummary[] = [];
    for (const row of rows) {
      validateElapsedWorldRow(row);
      const world =
        row.duration_kind === 'timed' &&
        (row.duration_unit === 'minute' ||
          row.duration_unit === 'hour' ||
          row.duration_unit === 'day');
      if (!world) continue;
      if ((row.deadline_elapsed_minutes as number) > input.elapsedMinutes)
        continue;
      const outcome = finalizeEnd(
        txnDb,
        row,
        {
          reason: 'expired',
          note: `world-time deadline ${row.deadline_elapsed_minutes} reached`,
        },
        input,
      );
      if (outcome.performed)
        expired.push({
          effectId: row.effect_id,
          displayName: row.display_name,
          deadlineElapsedMinutes: row.deadline_elapsed_minutes as number,
          cleanup: outcome.cleanup,
        });
    }
    return expired;
  });
}

/**
 * Deterministic round-deadline sweep: end every live round-unit timed effect
 * whose anchoring combat instance has reached or passed its deadline round.
 * Idempotent — already-ended effects are simply no longer live.
 */
export function expireElapsedRoundEffects(
  db: Db,
  input: ExpireElapsedRoundEffectsInput,
): ExpiredRoundEffectSummary[] {
  return withTransaction(db, (txnDb) => {
    const rows = txnDb
      .prepare(
        `SELECT ${EFFECT_COLUMNS} FROM active_effect
         WHERE campaign_id = ? AND status IN ('active', 'suppressed')
           AND duration_kind = 'timed' AND duration_unit = 'round'
         ORDER BY created_at, effect_id`,
      )
      .all(input.campaignId) as ActiveEffectRow[];
    const expired: ExpiredRoundEffectSummary[] = [];
    for (const row of rows) {
      const deadline = deadlineRound(row);
      if (
        deadline === undefined ||
        row.anchor_combat_instance_id === null ||
        row.anchor_kind === 'source-turn-start' ||
        row.anchor_kind === 'target-turn-start'
      ) {
        continue;
      }
      const instance = txnDb
        .prepare(
          `SELECT status, round_number FROM combat_instance
           WHERE campaign_id = ? AND combat_instance_id = ?`,
        )
        .get(input.campaignId, row.anchor_combat_instance_id) as
        | { status: string; round_number: number }
        | undefined;
      if (
        instance === undefined ||
        instance.status !== 'active' ||
        instance.round_number < deadline
      ) {
        continue;
      }
      // Snapshot loop: an earlier expiry's cleanup can cascade and end a
      // later snapshot row (owned-actor removal -> owner-removed break).
      // The primitive claims against the durable row; a stale entry loses
      // and is NOT reported as expired by this sweep.
      const outcome = finalizeEnd(
        txnDb,
        row,
        {
          reason: 'expired',
          note: `round deadline ${deadline} reached (round ${instance.round_number})`,
        },
        input,
      );
      if (outcome.performed) {
        expired.push({
          effectId: row.effect_id,
          displayName: row.display_name,
          deadlineRound: deadline,
          cleanup: outcome.cleanup,
        });
      }
    }
    return expired;
  });
}

/** Settle all engine-evaluable timers at an already-durable turn boundary.
 * The caller (F2 beginTurn) supplies the transaction; all endings use the
 * same finalizeEnd path as explicit expiry and therefore cascade atomically. */
export function settleEffectsAtTurnBoundary(
  db: Db,
  input: TurnBoundaryEffectInput,
): TurnBoundaryEffectSummary[] {
  const rows = db
    .prepare(
      `SELECT ${EFFECT_COLUMNS} FROM active_effect
       WHERE campaign_id = ? AND status IN ('active', 'suppressed')
         AND duration_kind = 'timed'
       ORDER BY created_at, effect_id`,
    )
    .all(input.campaignId) as ActiveEffectRow[];
  const settled: TurnBoundaryEffectSummary[] = [];
  // Validate every participant timer in this combat before any ending can
  // cascade. A malformed dormant row must abort the whole F2 transition.
  const participantDeadlines = new Map<string, ParticipantTimerDeadline>();
  for (const row of rows) {
    if (
      isParticipantTurnAnchor(row.anchor_kind) &&
      row.anchor_combat_instance_id === input.combatInstanceId
    ) {
      participantDeadlines.set(
        row.effect_id,
        requireParticipantTimerDeadline(
          row,
          readTargetRows(db, input.campaignId, row.effect_id),
        ),
      );
    }
  }
  // Phase 1 is deliberately independent of creation order: every ordinary
  // round deadline wins before participant-turn cleanup can cascade into it.
  const roundRows = rows.filter(
    (row) =>
      row.duration_unit === 'round' &&
      row.anchor_combat_instance_id === input.combatInstanceId &&
      !isParticipantTurnAnchor(row.anchor_kind),
  );
  for (const row of roundRows) {
    const deadline = deadlineRound(row);
    if (deadline === undefined || input.roundNumber < deadline) {
      continue;
    }
    const outcome = finalizeEnd(
      db,
      row,
      {
        reason: 'expired',
        note: `round deadline ${deadline} reached (round ${input.roundNumber})`,
        detail: 'round-deadline',
      },
      input,
    );
    if (outcome.performed) {
      settled.push({
        effectId: row.effect_id,
        displayName: row.display_name,
        deadlineRound: deadline,
        cleanup: outcome.cleanup,
        boundary: 'round-deadline',
        boundaryParticipant: input.participant,
        enteringTurnOrdinal: input.enteringTurnOrdinal,
      });
    }
  }

  // Phase 2 is restricted to the two supported participant anchors. In
  // particular, an unexpected anchor kind is never interpreted as a target
  // turn anchor merely because participant evidence happens to be present.
  const participantRows = rows.filter((row) => {
    const deadline = participantDeadlines.get(row.effect_id);
    return (
      deadline !== undefined &&
      deadline.participant.kind === input.participant.kind &&
      deadline.participant.ref === input.participant.ref &&
      input.enteringTurnOrdinal >= deadline.deadlineOrdinal
    );
  });
  for (const row of participantRows) {
    const deadline = participantDeadlines.get(row.effect_id);
    if (deadline === undefined) continue;
    const outcome = finalizeEnd(
      db,
      row,
      {
        reason: 'expired',
        detail: deadline.boundary,
        note: `${deadline.boundary} participant turn ordinal ${input.enteringTurnOrdinal}`,
      },
      input,
    );
    if (outcome.performed) {
      settled.push({
        effectId: row.effect_id,
        displayName: row.display_name,
        cleanup: outcome.cleanup,
        boundary: deadline.boundary,
        boundaryParticipant: input.participant,
        enteringTurnOrdinal: input.enteringTurnOrdinal,
        deadlineTurnOrdinal: deadline.deadlineOrdinal,
      });
    }
  }
  return settled;
}

// ---------------------------------------------------------------------------
// Combat-instance closure policy (F3 mutation audit §7)
// ---------------------------------------------------------------------------

export interface CombatClosureEffectReactions {
  /** Round-anchored live effects expired at the closure boundary. */
  readonly timersExpired: readonly {
    readonly effectId: string;
    readonly displayName: string;
  }[];
  /** Combatant-owned concentration effects ended (cause 'owner-removed'). */
  readonly concentrationBroken: readonly {
    readonly effectId: string;
    readonly displayName: string;
  }[];
  /** Combatant targets of the closing instance removed ('combat-ended'). */
  readonly targetsRemoved: number;
  /** Condition links removed / actor links released ('combat-ended'). */
  readonly linksCleaned: number;
  /** Live effects whose source actor was a closing combatant: the pointer
   *  was detached (the created event keeps the provenance forever). */
  readonly sourceActorsDetached: number;
  readonly actorsRebound: number;
  readonly sourceActorsRebound: number;
  readonly targetsRebound: number;
  readonly linksRebound: number;
  readonly instanceOnlyLinksReleased: number;
}

interface RebindCounts {
  actorsRebound: number;
  sourceActorsRebound: number;
  targetsRebound: number;
  linksRebound: number;
}

function liveEffectRowsOrdered(db: Db, campaignId: string): ActiveEffectRow[] {
  return db
    .prepare(
      `SELECT ${EFFECT_COLUMNS} FROM active_effect
       WHERE campaign_id = ? AND status IN ('active', 'suppressed')
       ORDER BY created_at, effect_id`,
    )
    .all(campaignId) as ActiveEffectRow[];
}

/** Rebind every live reference to a combatant (actor/condition links, targets,
 *  source actor) onto its durable campaign actor, recording what moved in
 *  `rebindEvidence`. Shared by combat closure and the bonded-summon presence
 *  transitions (eshyra-82uk), so the rebinding rules cannot drift. */
function rebindCombatantReferencesToActor(
  db: Db,
  campaignId: string,
  combatantId: string,
  actorId: string,
  combatInstanceId: string,
  ctx: EffectMutationContext,
  rebindEvidence: Map<string, Record<string, unknown>>,
  counts: RebindCounts,
): void {
  const affected = liveEffectRowsOrdered(db, campaignId).filter(
    (row) => row.status !== 'ended',
  );
  for (const row of affected) {
    const links = readLinkRows(db, campaignId, row.effect_id).filter(
      (link) =>
        link.status === 'active' &&
        link.target_kind === 'combatant' &&
        link.target_ref === combatantId,
    );
    for (const link of links) {
      db.prepare(
        `UPDATE active_effect_link SET target_kind = 'campaign_actor', target_ref = ?,
           campaign_actor_id = COALESCE(campaign_actor_id, ?), provenance = ?, session_id = ?, updated_at = ?
         WHERE campaign_id = ? AND effect_id = ? AND link_kind = ? AND target_kind = 'combatant' AND target_ref = ? AND projection_ref = ?`,
      ).run(
        actorId,
        actorId,
        ctx.provenance,
        ctx.sessionId,
        ctx.at,
        campaignId,
        row.effect_id,
        link.link_kind,
        combatantId,
        link.projection_ref,
      );
      counts.linksRebound += 1;
      if (link.link_kind === 'actor') counts.actorsRebound += 1;
      const evidence = rebindEvidence.get(row.effect_id) ?? {
        combatInstanceId,
        referencesRebound: [],
        actorSnapshots: [],
      };
      (evidence.referencesRebound as unknown[]).push({
        kind: link.link_kind === 'condition' ? 'condition-link' : 'actor-link',
        old: { kind: 'combatant', ref: combatantId },
        campaignActorId: actorId,
      });
      rebindEvidence.set(row.effect_id, evidence);
    }
    const target = db
      .prepare(
        `SELECT 1 FROM active_effect_target WHERE campaign_id = ? AND effect_id = ? AND target_kind = 'combatant' AND target_ref = ? AND status = 'active'`,
      )
      .get(campaignId, row.effect_id, combatantId);
    if (target !== undefined) {
      db.prepare(
        `UPDATE active_effect_target SET target_kind = 'campaign_actor', target_ref = ?, provenance = ?, session_id = ?, updated_at = ?
         WHERE campaign_id = ? AND effect_id = ? AND target_kind = 'combatant' AND target_ref = ? AND status = 'active'`,
      ).run(
        actorId,
        ctx.provenance,
        ctx.sessionId,
        ctx.at,
        campaignId,
        row.effect_id,
        combatantId,
      );
      counts.targetsRebound += 1;
      const evidence = rebindEvidence.get(row.effect_id) ?? {
        combatInstanceId,
        referencesRebound: [],
        actorSnapshots: [],
      };
      (evidence.referencesRebound as unknown[]).push({
        kind: 'target',
        old: { kind: 'combatant', ref: combatantId },
        campaignActorId: actorId,
      });
      rebindEvidence.set(row.effect_id, evidence);
    }
    const source = readEffectRow(db, campaignId, row.effect_id);
    if (
      source?.source_actor_kind === 'combatant' &&
      source.source_actor_ref === combatantId
    ) {
      db.prepare(
        `UPDATE active_effect SET source_actor_kind = 'campaign_actor', source_actor_ref = ?, provenance = ?, session_id = ?, updated_at = ? WHERE campaign_id = ? AND effect_id = ?`,
      ).run(
        actorId,
        ctx.provenance,
        ctx.sessionId,
        ctx.at,
        campaignId,
        row.effect_id,
      );
      counts.sourceActorsRebound += 1;
      const evidence = rebindEvidence.get(row.effect_id) ?? {
        combatInstanceId,
        referencesRebound: [],
        actorSnapshots: [],
      };
      (evidence.referencesRebound as unknown[]).push({
        kind: 'source-actor',
        old: { kind: 'combatant', ref: combatantId },
        campaignActorId: actorId,
      });
      rebindEvidence.set(row.effect_id, evidence);
    }
  }
}

/**
 * Apply the fail-closed combat-closure boundary to live effect state, called
 * by `closeCombatInstance` inside its transaction and BEFORE the instance
 * status flips, while the instance's combatants are still mutable.
 * Deterministic precedence (F3 mutation audit §7):
 *
 * 1. **Timers settle first**: every live effect whose round-unit timer is
 *    anchored to the closing instance expires (reason 'expired') — its clock
 *    can never advance again, and round-scale durations (6s/round) elapse
 *    before anything mechanically relevant can happen after combat. The
 *    audit note distinguishes deadline-reached from remaining-rounds cases.
 * 2. Live concentration owned by a combatant of the instance breaks
 *    (cause 'owner-removed') with break-policy cleanup.
 * 3. Remaining live effects' active combatant targets of the instance are
 *    removed (reason 'combat-ended'), cleaning exactly their projections.
 * 4. Leftover active condition links on the instance's combatants are
 *    removed (while the holder is still reachable) and active actor links
 *    are released; live effects whose `source.actor` is an instance
 *    combatant have that pointer detached (columns nulled — the 'created'
 *    event records the original actor permanently). Recorded per effect in
 *    a 'combat-closed' audit event.
 *
 * Every step re-reads liveness before writing: any step's cleanup can
 * cascade (owned-actor removal → actor inactive → its concentration breaks)
 * and end an effect a later step would otherwise touch. Character-owned
 * effects with no combatant references survive untouched — combat ending
 * does not end spells. Rebinding persistent summons to campaign-actor
 * identity is eshyra-2n1t.5.3.
 */
export function applyCombatClosureToEffects(
  db: Db,
  campaignId: string,
  combatInstanceId: string,
  ctx: EffectMutationContext,
): CombatClosureEffectReactions {
  const combatantIds = new Set(
    (
      db
        .prepare(
          `SELECT combatant_id FROM encounter_combatant
           WHERE campaign_id = ? AND combat_instance_id = ?
           ORDER BY combatant_id`,
        )
        .all(campaignId, combatInstanceId) as { combatant_id: string }[]
    ).map((row) => row.combatant_id),
  );

  const liveRowsOrdered = () =>
    db
      .prepare(
        `SELECT ${EFFECT_COLUMNS} FROM active_effect
         WHERE campaign_id = ? AND status IN ('active', 'suppressed')
         ORDER BY created_at, effect_id`,
      )
      .all(campaignId) as ActiveEffectRow[];

  // 1. Settle round timers anchored to this instance — regardless of owner,
  // source, targets, links, or suppression. A committed live effect may
  // never retain a timer whose clock cannot advance.
  const timersExpired: { effectId: string; displayName: string }[] = [];
  const closureRows = liveRowsOrdered();
  const participantDeadlines = new Map<string, ParticipantTimerDeadline>();
  for (const row of closureRows) {
    if (
      isParticipantTurnAnchor(row.anchor_kind) &&
      row.anchor_combat_instance_id === combatInstanceId
    ) {
      participantDeadlines.set(
        row.effect_id,
        requireParticipantTimerDeadline(
          row,
          readTargetRows(db, campaignId, row.effect_id),
        ),
      );
    }
  }
  for (const row of closureRows) {
    if (
      row.duration_kind !== 'timed' ||
      row.duration_unit !== 'round' ||
      row.anchor_combat_instance_id !== combatInstanceId
    ) {
      continue;
    }
    const instanceRound = db
      .prepare(
        `SELECT round_number FROM combat_instance
         WHERE campaign_id = ? AND combat_instance_id = ?`,
      )
      .get(campaignId, combatInstanceId) as { round_number: number };
    const participantAnchor = isParticipantTurnAnchor(row.anchor_kind);
    let deadline: number | undefined;
    let remaining: number;
    let remainingLabel: string;
    if (participantAnchor) {
      const participantDeadline = participantDeadlines.get(row.effect_id);
      if (participantDeadline === undefined) continue;
      const currentParticipantOrdinal = readAnchorTurnOrdinal(
        db,
        campaignId,
        combatInstanceId,
        participantDeadline.participant as {
          kind: 'character' | 'combatant';
          ref: string;
        },
      );
      deadline = participantDeadline.deadlineOrdinal;
      remaining = Math.max(0, deadline - currentParticipantOrdinal);
      remainingLabel = 'participant turn-start boundary/boundaries';
    } else {
      deadline = deadlineRound(row);
      remaining =
        deadline === undefined
          ? 0
          : Math.max(0, deadline - Math.max(1, instanceRound.round_number));
      remainingLabel = 'round(s)';
    }
    // Snapshot loop: an earlier settlement's cleanup can cascade and end a
    // later snapshot row (e.g. expiring A removes its owned actor, whose
    // inactivation breaks B as owner-removed). The primitive claims against
    // the durable row; a stale entry loses, keeps its winning terminal
    // reason, and is NOT reported in timersExpired.
    const outcome = finalizeEnd(
      db,
      row,
      {
        reason: 'expired',
        note:
          remaining === 0
            ? participantAnchor
              ? `participant turn deadline ${deadline} reached when combat instance '${combatInstanceId}' closed`
              : `round deadline ${deadline} reached when combat instance '${combatInstanceId}' closed`
            : `combat instance '${combatInstanceId}' closed with ${remaining} ${remainingLabel} remaining; ` +
              'the round-scale duration elapses as combat ends',
      },
      ctx,
    );
    if (outcome.performed) {
      timersExpired.push({
        effectId: row.effect_id,
        displayName: row.display_name,
      });
    }
  }

  if (combatantIds.size === 0) {
    return {
      timersExpired,
      concentrationBroken: [],
      targetsRemoved: 0,
      linksCleaned: 0,
      sourceActorsDetached: 0,
      actorsRebound: 0,
      sourceActorsRebound: 0,
      targetsRebound: 0,
      linksRebound: 0,
      instanceOnlyLinksReleased: 0,
    };
  }

  // 2. Break combatant-owned concentration (re-read liveness: a timer
  // settlement above may already have ended the effect).
  const concentrationBroken: { effectId: string; displayName: string }[] = [];
  for (const row of liveRowsOrdered()) {
    if (
      row.requires_concentration !== 1 ||
      row.concentration_owner_kind !== 'combatant' ||
      row.concentration_owner_ref === null ||
      !combatantIds.has(row.concentration_owner_ref)
    ) {
      continue;
    }
    // Snapshot loop over a fresh re-read; the primitive still decides.
    const live = readEffectRow(db, campaignId, row.effect_id);
    if (live === undefined || live.status === 'ended') {
      continue;
    }
    const outcome = finalizeEnd(
      db,
      live,
      {
        reason: 'concentration-broken',
        detail: 'owner-removed',
        note: `combat instance '${combatInstanceId}' closed`,
      },
      ctx,
    );
    if (outcome.performed) {
      concentrationBroken.push({
        effectId: row.effect_id,
        displayName: row.display_name,
      });
    }
  }

  // 3. Establish durable identities before touching any remaining reference.
  // A link is the explicit persistence marker; an already campaign-projected
  // combatant is durable by definition. Claims are checked before references
  // move so SQLite rollback preserves the entire close on collision.
  const actorMap = new Map<string, string>();
  for (const id of [...combatantIds].sort()) {
    const combatant = db
      .prepare(
        `SELECT identity_kind, identity_ref FROM encounter_combatant
       WHERE campaign_id = ? AND combatant_id = ?`,
      )
      .get(campaignId, id) as
      | { identity_kind: string; identity_ref: string | null }
      | undefined;
    const claims = db
      .prepare(
        `SELECT effect_id, campaign_actor_id FROM active_effect_link
       WHERE campaign_id = ? AND link_kind = 'actor' AND target_kind = 'combatant'
         AND target_ref = ? AND status = 'active' AND campaign_actor_id IS NOT NULL`,
      )
      .all(campaignId, id) as {
      effect_id: string;
      campaign_actor_id: string;
    }[];
    const durable =
      combatant?.identity_kind === 'campaign_actor'
        ? combatant.identity_ref
        : claims[0]?.campaign_actor_id;
    if (durable === undefined || durable === null) continue;
    // A bonded creature dismissed and recalled in this instance leaves an
    // older absent row behind (eshyra-82uk): only its newest row speaks for
    // the actor, and its references were rebound when it left.
    if (
      combatant?.identity_kind === 'campaign_actor' &&
      db
        .prepare(
          `SELECT 1 FROM encounter_combatant
           WHERE campaign_id = ? AND combat_instance_id = ?
             AND identity_kind = 'campaign_actor' AND identity_ref = ?
             AND rowid > (SELECT rowid FROM encounter_combatant
                          WHERE campaign_id = ? AND combatant_id = ?)
           LIMIT 1`,
        )
        .get(campaignId, combatInstanceId, durable, campaignId, id) !==
        undefined
    )
      continue;
    const directOwner = db
      .prepare(
        `SELECT effect_id FROM active_effect_link
         WHERE campaign_id = ? AND link_kind = 'actor' AND target_kind = 'campaign_actor'
           AND target_ref = ? AND status = 'active'`,
      )
      .get(campaignId, durable) as { effect_id: string } | undefined;
    if (
      directOwner !== undefined &&
      claims.some((claim) => claim.effect_id !== directOwner.effect_id)
    ) {
      throw new ActiveEffectError(
        `campaign actor '${durable}' is already owned by effect '${directOwner.effect_id}' and cannot be claimed by another effect`,
      );
    }
    if (claims.some((claim) => claim.campaign_actor_id !== durable)) {
      throw new ActiveEffectError(
        `combatant '${id}' has incompatible durable actor claims`,
      );
    }
    const prior = [...actorMap.entries()].find(
      ([, actorId]) => actorId === durable,
    );
    if (prior !== undefined && prior[0] !== id) {
      throw new ActiveEffectError(
        `campaign actor '${durable}' is claimed by multiple closing combatants`,
      );
    }
    ensureCampaignActorFromCombatant(db, {
      campaignId,
      combatantId: id,
      actorId: durable,
      ...ctx,
    });
    actorMap.set(id, durable);
  }

  // Rebind the complete F3 topology. Concentration and participant clocks are
  // deliberately absent here: they were settled above and remain combatant
  // only by contract.
  const rebindCounts: RebindCounts = {
    actorsRebound: 0,
    sourceActorsRebound: 0,
    targetsRebound: 0,
    linksRebound: 0,
  };
  const rebindEvidence = new Map<string, Record<string, unknown>>();
  for (const [combatantId, actorId] of actorMap) {
    rebindCombatantReferencesToActor(
      db,
      campaignId,
      combatantId,
      actorId,
      combatInstanceId,
      ctx,
      rebindEvidence,
      rebindCounts,
    );
  }
  const { actorsRebound, sourceActorsRebound, targetsRebound, linksRebound } =
    rebindCounts;
  // 4 + 5. Detach/remove remaining instance-only references.
  // Actor links are released FIRST: a combatant that is both a target and
  // an owned actor keeps the release disposition (the engine relinquishes
  // ownership; it does not inactivate the entity at combat close), and the
  // later target removal then only cleans condition projections.
  let targetsRemoved = 0;
  let linksCleaned = 0;
  let sourceActorsDetached = 0;
  for (const row of liveRowsOrdered()) {
    const actions: EffectCleanupAction[] = [];
    for (const link of readLinkRows(db, campaignId, row.effect_id)) {
      if (
        link.status !== 'active' ||
        link.link_kind !== 'actor' ||
        link.target_kind !== 'combatant' ||
        !combatantIds.has(link.target_ref)
      ) {
        continue;
      }
      db.prepare(
        `UPDATE active_effect_link
         SET status = 'released', removed_reason = 'combat-ended',
             removed_at = ?, provenance = ?, session_id = ?, updated_at = ?
         WHERE campaign_id = ? AND effect_id = ? AND link_kind = ?
           AND target_kind = ? AND target_ref = ? AND projection_ref = ?`,
      ).run(
        ctx.at,
        ctx.provenance,
        ctx.sessionId,
        ctx.at,
        campaignId,
        row.effect_id,
        link.link_kind,
        link.target_kind,
        link.target_ref,
        link.projection_ref,
      );
      actions.push({
        linkKind: link.link_kind,
        target: { kind: link.target_kind, ref: link.target_ref },
        projectionRef: link.projection_ref,
        action: 'released',
      });
      linksCleaned += 1;
    }
    for (const target of readTargetRows(db, campaignId, row.effect_id)) {
      if (
        target.status !== 'active' ||
        target.target_kind !== 'combatant' ||
        !combatantIds.has(target.target_ref)
      ) {
        continue;
      }
      // removeEffectTarget is itself re-entrancy safe; a cascade from an
      // earlier removal can end this effect, so re-check before each call.
      if (readEffectRow(db, campaignId, row.effect_id)?.status === 'ended') {
        break;
      }
      removeEffectTarget(db, {
        campaignId,
        effectId: row.effect_id,
        target: { kind: 'combatant', ref: target.target_ref },
        reason: 'combat-ended',
        ...ctx,
      });
      targetsRemoved += 1;
    }
    if (readEffectRow(db, campaignId, row.effect_id)?.status === 'ended') {
      continue;
    }

    let effectEnded = false;
    for (const link of readLinkRows(db, campaignId, row.effect_id)) {
      if (
        link.status !== 'active' ||
        link.link_kind === 'actor' ||
        link.target_kind !== 'combatant' ||
        !combatantIds.has(link.target_ref)
      ) {
        continue;
      }
      // Leftover condition links (holders that were never effect targets)
      // are removed while the holder is still mutable. The projection
      // removal may cascade; never overwrite a terminal close.
      const action: EffectCleanupAction['action'] = removeProjection(
        db,
        campaignId,
        link,
        ctx,
      );
      const after = readLinkRows(db, campaignId, row.effect_id).find(
        (candidate) =>
          candidate.link_kind === link.link_kind &&
          candidate.target_kind === link.target_kind &&
          candidate.target_ref === link.target_ref &&
          candidate.projection_ref === link.projection_ref,
      );
      if (after !== undefined && after.status === 'active') {
        db.prepare(
          `UPDATE active_effect_link
           SET status = ?, removed_reason = 'combat-ended', removed_at = ?,
               provenance = ?, session_id = ?, updated_at = ?
           WHERE campaign_id = ? AND effect_id = ? AND link_kind = ?
             AND target_kind = ? AND target_ref = ? AND projection_ref = ?`,
        ).run(
          'removed',
          ctx.at,
          ctx.provenance,
          ctx.sessionId,
          ctx.at,
          campaignId,
          row.effect_id,
          link.link_kind,
          link.target_kind,
          link.target_ref,
          link.projection_ref,
        );
        actions.push({
          linkKind: link.link_kind,
          target: { kind: link.target_kind, ref: link.target_ref },
          projectionRef: link.projection_ref,
          action,
        });
        linksCleaned += 1;
      }
      if (readEffectRow(db, campaignId, row.effect_id)?.status === 'ended') {
        effectEnded = true;
        break;
      }
    }
    if (effectEnded) {
      continue;
    }

    // Source-actor detach: the pointer becomes unenforceable at closure; the
    // effect itself survives (an NPC-cast curse on the PC outlives combat).
    let detachedSourceActor:
      | { kind: EffectParticipantKind; ref: string }
      | undefined;
    if (
      row.source_actor_kind === 'combatant' &&
      row.source_actor_ref !== null &&
      combatantIds.has(row.source_actor_ref)
    ) {
      db.prepare(
        `UPDATE active_effect
         SET source_actor_kind = NULL, source_actor_ref = NULL,
             provenance = ?, session_id = ?, updated_at = ?
         WHERE campaign_id = ? AND effect_id = ?`,
      ).run(ctx.provenance, ctx.sessionId, ctx.at, campaignId, row.effect_id);
      detachedSourceActor = {
        kind: row.source_actor_kind,
        ref: row.source_actor_ref,
      };
      sourceActorsDetached += 1;
    }

    if (actions.length > 0 || detachedSourceActor !== undefined) {
      appendEvent(
        db,
        campaignId,
        row.effect_id,
        'combat-closed',
        {
          combatInstanceId,
          ...(rebindEvidence.get(row.effect_id) ?? {}),
          cleanup: actions.map((action) => ({
            linkKind: action.linkKind,
            targetKind: action.target.kind,
            targetRef: action.target.ref,
            projectionRef: action.projectionRef,
            action: action.action,
          })),
          ...(detachedSourceActor === undefined
            ? {}
            : { sourceActorDetached: { ...detachedSourceActor } }),
        },
        ctx,
      );
    }
  }
  for (const [effectId, evidence] of rebindEvidence) {
    if (readEffectRow(db, campaignId, effectId)?.status !== 'ended') {
      evidence.actorSnapshots = [...new Set(actorMap.values())]
        .map((actorId) => getCampaignActor(db, campaignId, actorId))
        .filter(
          (actor): actor is NonNullable<typeof actor> => actor !== undefined,
        )
        .map((actor) => ({
          actorId: actor.actorId,
          displayName: actor.displayName,
          rulesRef: actor.rulesRef,
          hpCurrent: actor.hpCurrent,
          hpMax: actor.hpMax,
          conditions: actor.conditions,
          status: actor.status,
          currentLocationId: actor.currentLocationId,
        }));
      // Effects with fallback cleanup already received a combined event above.
      const hasFallback = listEffectEvents(db, campaignId, effectId).some(
        (event) =>
          event.eventKind === 'combat-closed' &&
          event.detail.combatInstanceId === combatInstanceId &&
          event.detail.referencesRebound !== undefined,
      );
      if (!hasFallback)
        appendEvent(db, campaignId, effectId, 'combat-closed', evidence, ctx);
    }
  }
  return {
    timersExpired,
    concentrationBroken,
    targetsRemoved,
    linksCleaned,
    sourceActorsDetached,
    actorsRebound,
    sourceActorsRebound,
    targetsRebound,
    linksRebound,
    instanceOnlyLinksReleased: linksCleaned,
  };
}
