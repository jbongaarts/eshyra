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
// combinations fail closed. `zone` and `form` links are schema-reserved for
// the S3 ward / transformation rollout beads and are refused here.

import type { Db } from '../persistence/db.js';
import { withTransaction } from '../persistence/db.js';
import { jsonColumn } from '../persistence/jsonColumn.js';
import { lookupCampaignRecord } from './campaignRecordLookup.js';
import { addCondition, removeCondition } from './domainMutations.js';
import {
  EncounterCombatantError,
  getActiveCombatInstance,
  updateCombatant,
} from './encounterCombatants.js';
import type { CharacterConditionEntry } from './liveStateSchema.js';
import { validateConditionsJson } from './liveStateSchema.js';
import { MutateStateError } from './mutateState.js';

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

export type EffectParticipantKind = 'character' | 'combatant';

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

/** Anchors whose semantics the engine fully supports today. The other three
 *  are schema-reserved for the F2 turn-boundary/trigger integration
 *  (eshyra-2n1t.5.1) and are refused at creation/refresh. */
export const SUPPORTED_EFFECT_ANCHOR_KINDS: readonly EffectAnchorKind[] = [
  'spell-cast',
  'effect-created',
];

/** Typed duration: every timer names quantity + semantic unit + anchor. */
export type EffectDurationInput =
  | {
      readonly kind: 'timed';
      readonly amount: number;
      readonly unit: EffectDurationUnit;
      readonly anchor: EffectAnchorKind;
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
] as const;
export type ConcentrationBreakCause =
  (typeof CONCENTRATION_BREAK_CAUSES)[number];

/** Break causes callers may pass to {@link endActiveEffect} directly; the
 *  evidence-gated causes are reachable only through their owning paths
 *  (resolveConcentrationCheck, the create replacement path, the F6 hook). */
export const DIRECT_CONCENTRATION_BREAK_CAUSES: readonly ConcentrationBreakCause[] =
  ['voluntary', 'forced'];

export type EffectLinkKind = 'condition' | 'actor' | 'zone' | 'form';
export type EffectCleanupPolicy = 'remove' | 'release';
export type EffectTargetKind = 'character' | 'combatant' | 'scope';

export interface EffectMutationContext {
  readonly provenance: string;
  readonly sessionId: string;
  readonly at: string;
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
  readonly target: EffectParticipant;
  readonly projectionRef: string;
  readonly cleanupOnEnd: EffectCleanupPolicy;
  readonly cleanupOnBreak: EffectCleanupPolicy;
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
  /** Round the effect expires at (round-unit timers): anchor + amount. */
  readonly deadlineRound?: number;
  readonly trigger?: string;
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
  readonly target: EffectParticipant;
  readonly projectionRef: string;
  /** 'removed' = projection deleted; 'released' = ownership dropped, state
   *  left in place; 'missing' = the projection's holder no longer exists /
   *  is unreachable, so only the link record was closed. */
  readonly action: 'removed' | 'released' | 'missing';
}

export interface EffectCleanupSummary {
  readonly links: readonly EffectCleanupAction[];
  readonly targetsRemoved: number;
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

export interface SuppressEffectInput extends EffectMutationContext {
  readonly campaignId: string;
  readonly effectId: string;
  readonly note?: string;
}

export interface ExpireElapsedRoundEffectsInput extends EffectMutationContext {
  readonly campaignId: string;
}

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
    sourceKinds: ['spell', 'feature', 'ruling'],
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

// 'zone' and 'form' link kinds are schema-reserved for the S3 ward/spatial
// and transformation rollout beads: CreateActiveEffectInput exposes no path
// that creates them, so they cannot exist as active rows until those beads
// add validated projection runtimes.

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
  readonly anchor_combat_instance_id: string | null;
  readonly anchor_round: number | null;
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
  readonly target_kind: EffectParticipantKind;
  readonly target_ref: string;
  readonly projection_ref: string;
  readonly cleanup_on_end: EffectCleanupPolicy;
  readonly cleanup_on_break: EffectCleanupPolicy;
  readonly status: 'active' | 'removed' | 'released';
  readonly removed_reason: string | null;
  readonly removed_at: string | null;
}

const detailColumn = jsonColumn<Record<string, unknown>>(
  'active_effect_event.detail_json',
);

const EFFECT_COLUMNS = `campaign_id, effect_id, kind, display_name,
  source_kind, source_ref, source_actor_kind, source_actor_ref,
  requires_concentration, concentration_owner_kind, concentration_owner_ref,
  duration_kind, duration_amount, duration_unit, anchor_kind, anchor_at,
  anchor_game_time, anchor_combat_instance_id, anchor_round, expiry_trigger,
  dismissible, status, end_reason, end_detail, ended_at, created_at`;

// ---------------------------------------------------------------------------
// Row -> view (with load-time structural validation)
// ---------------------------------------------------------------------------

/** Rounds a round-unit timer runs for: the deadline round is anchor+amount. */
function deadlineRound(row: ActiveEffectRow): number | undefined {
  if (
    row.duration_kind !== 'timed' ||
    row.duration_unit !== 'round' ||
    row.anchor_round === null ||
    row.duration_amount === null
  ) {
    return undefined;
  }
  return row.anchor_round + row.duration_amount;
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
    ...(deadlineRound(row) === undefined
      ? {}
      : { deadlineRound: deadlineRound(row) }),
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
      cleanupOnEnd: link.cleanup_on_end,
      cleanupOnBreak: link.cleanup_on_break,
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

function readLinkRows(
  db: Db,
  campaignId: string,
  effectId: string,
): EffectLinkRow[] {
  return db
    .prepare(
      `SELECT effect_id, link_kind, target_kind, target_ref, projection_ref,
              cleanup_on_end, cleanup_on_break, status, removed_reason,
              removed_at
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
 * Referential-integrity audit over durable effect state: dangling character/
 * combatant references and structural violations, reported (not thrown) so
 * debug surfaces can show them. The strict read boundary is
 * {@link listActiveEffects}.
 */
export function auditActiveEffectIntegrity(
  db: Db,
  campaignId: string,
): ActiveEffectIntegrityIssue[] {
  const issues: ActiveEffectIntegrityIssue[] = [];
  const rows = db
    .prepare(
      `SELECT ${EFFECT_COLUMNS} FROM active_effect WHERE campaign_id = ?`,
    )
    .all(campaignId) as ActiveEffectRow[];
  for (const row of rows) {
    const targets = readTargetRows(db, campaignId, row.effect_id);
    const links = readLinkRows(db, campaignId, row.effect_id);
    try {
      effectView(row, targets, links);
    } catch (e) {
      issues.push({
        effectId: row.effect_id,
        issue: e instanceof Error ? e.message : String(e),
      });
      continue;
    }
    if (row.status === 'ended') {
      continue;
    }
    for (const participant of [
      ...targets
        .filter((t) => t.status === 'active' && t.target_kind !== 'scope')
        .map((t) => ({
          kind: t.target_kind as EffectParticipantKind,
          ref: t.target_ref,
          role: 'target',
        })),
      ...links
        .filter((l) => l.status === 'active')
        .map((l) => ({
          kind: l.target_kind,
          ref: l.target_ref,
          role: `${l.link_kind} link`,
        })),
    ]) {
      if (!participantExists(db, campaignId, participant)) {
        issues.push({
          effectId: row.effect_id,
          issue: `${participant.role} references missing ${participant.kind} '${participant.ref}'`,
        });
      }
    }
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

function participantExists(
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
  return (
    db
      .prepare(
        `SELECT 1 FROM encounter_combatant
         WHERE campaign_id = ? AND combatant_id = ?`,
      )
      .get(campaignId, participant.ref) !== undefined
  );
}

function requireParticipant(
  db: Db,
  campaignId: string,
  participant: EffectParticipant,
  label: string,
): void {
  requireNonEmptyString(participant.ref, `${label} ref`);
  if (participant.kind !== 'character' && participant.kind !== 'combatant') {
    throw new ActiveEffectError(
      `${label} kind must be 'character' or 'combatant'`,
    );
  }
  if (!participantExists(db, campaignId, participant)) {
    throw new ActiveEffectError(
      `${label} references unknown ${participant.kind} '${participant.ref}'`,
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
 * Concentration requires a capable owner: an incapacitated or dead creature
 * cannot start concentrating (SRD concentration). This must be checked at
 * creation because the F6/combatant cleanup hooks fire only on *transitions*
 * (alive → non-alive, up → down) — admitting an already-down owner here
 * would create a live concentration effect nothing ever cleans up.
 */
function requireConcentrationCapableOwner(
  db: Db,
  campaignId: string,
  owner: EffectParticipant,
): void {
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
    return;
  }
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
      row.status === 'unconscious')
  ) {
    throw new ActiveEffectError(
      `combatant '${owner.ref}' is down (${
        row.status === 'dead' || row.status === 'unconscious'
          ? row.status
          : '0 HP'
      }) and cannot concentrate`,
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
 * always available, and the remaining anchors are schema-reserved until the
 * F2 turn-boundary/trigger integration gives them exact semantics
 * (eshyra-2n1t.5.1) — accepting them now would stamp an anchor the engine
 * cannot honestly evaluate.
 */
function validateDuration(
  db: Db,
  campaignId: string,
  duration: EffectDurationInput,
  dismissible: boolean,
  sourceKind: EffectSourceKind,
  ctx: EffectMutationContext,
): ValidatedDuration {
  const empty: Omit<ValidatedDuration, 'kind'> = {
    amount: null,
    unit: null,
    anchorKind: null,
    anchorAt: null,
    anchorGameTime: null,
    anchorCombatInstanceId: null,
    anchorRound: null,
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
      if (!SUPPORTED_EFFECT_ANCHOR_KINDS.includes(duration.anchor)) {
        throw new ActiveEffectError(
          `anchor '${duration.anchor}' is schema-reserved until the F2 turn-boundary/` +
            'trigger integration lands (eshyra-2n1t.5.1); anchor to ' +
            `${SUPPORTED_EFFECT_ANCHOR_KINDS.join(' or ')} instead`,
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
      return {
        kind: 'timed',
        amount: duration.amount,
        unit: duration.unit,
        anchorKind: duration.anchor,
        anchorAt: ctx.at,
        anchorGameTime: readGameTime(db) ?? null,
        anchorCombatInstanceId: instanceId,
        anchorRound: round,
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
    let action: EffectCleanupAction['action'];
    if (policy === 'release') {
      action = 'released';
    } else {
      action = removeProjection(db, campaignId, link, ctx);
    }
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
    try {
      updateCombatant(db, {
        campaignId,
        combatantId: link.projection_ref,
        status: 'inactive',
        ...ctx,
      });
      return 'removed';
    } catch (e) {
      if (e instanceof EncounterCombatantError) {
        return 'missing';
      }
      throw e;
    }
  }
  // zone/form are schema-reserved and cannot be created, so an active row of
  // that kind is corrupt state; close the link and report it missing.
  return 'missing';
}

interface FinalizeEndInput {
  readonly reason: EffectEndReason;
  readonly detail?: string;
  readonly note?: string;
  readonly trigger?: string;
}

/** Shared terminal transition: cleanup + status flip + 'ended' event. */
function finalizeEnd(
  db: Db,
  row: ActiveEffectRow,
  input: FinalizeEndInput,
  ctx: EffectMutationContext,
): EffectCleanupSummary {
  const mode = input.reason === 'concentration-broken' ? 'break' : 'end';
  const reasonLabel =
    input.detail === undefined
      ? input.reason
      : `${input.reason}:${input.detail}`;
  const cleanup = cleanupOwnedState(
    db,
    row.campaign_id,
    row.effect_id,
    mode,
    reasonLabel,
    ctx,
  );
  db.prepare(
    `UPDATE active_effect
     SET status = 'ended', end_reason = ?, end_detail = ?, ended_at = ?,
         provenance = ?, session_id = ?, updated_at = ?
     WHERE campaign_id = ? AND effect_id = ?`,
  ).run(
    input.reason,
    input.detail ?? null,
    ctx.at,
    ctx.provenance,
    ctx.sessionId,
    ctx.at,
    row.campaign_id,
    row.effect_id,
  );
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
  return cleanup;
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

    // Source grounding.
    if (!profile.sourceKinds.includes(input.source.kind)) {
      throw new ActiveEffectError(
        `a '${input.kind}' effect cannot come from source kind '${input.source.kind}' ` +
          `(allowed: ${profile.sourceKinds.join(', ')})`,
      );
    }
    let concentrationRule: 'required' | 'forbidden' | 'declared' = 'declared';
    let recordDuration: ParsedSpellDurationForm | undefined;
    if (input.source.kind === 'spell') {
      const ref = requireNonEmptyString(
        input.source.ref,
        "a spell-sourced effect's source.ref",
      );
      const record = lookupCampaignRecord(txnDb, 'spell', ref);
      if (record === undefined) {
        throw new ActiveEffectError(
          `source.ref '${ref}' does not resolve to a spell record in the campaign rules stack; ` +
            "find the exact key via lookup_rules, or use source kind 'ruling' for homebrew",
        );
      }
      const data = record.data as Record<string, unknown>;
      if (typeof data.duration === 'string') {
        const parsed = parseSpellDurationText(data.duration);
        concentrationRule = parsed.concentration ? 'required' : 'forbidden';
        recordDuration = parsed.form;
        if (parsed.form.kind === 'instantaneous') {
          throw new ActiveEffectError(
            `'${record.name}' is instantaneous per its record; instantaneous spells leave no ` +
              'active effect — their consequences land through their own mutations',
          );
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
        if (
          link.status === 'active' &&
          link.link_kind === 'condition' &&
          link.cleanup_on_break === 'remove'
        ) {
          replacementRemovals.add(
            `${link.target_kind}:${link.target_ref}:${link.projection_ref}`,
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

    // Targets.
    const targets = input.targets ?? [];
    const seenTargets = new Set<string>();
    for (const target of targets) {
      requireNonEmptyString(target.ref, 'target ref');
      if (
        target.kind !== 'character' &&
        target.kind !== 'combatant' &&
        target.kind !== 'scope'
      ) {
        throw new ActiveEffectError(
          "target kind must be 'character', 'combatant', or 'scope'",
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
      const key = `${projection.target.kind}:${projection.target.ref}:${projection.condition.id}`;
      if (seenProjections.has(key)) {
        throw new ActiveEffectError(
          `duplicate condition projection '${projection.condition.id}' on ` +
            `${projection.target.kind} '${projection.target.ref}'`,
        );
      }
      seenProjections.add(key);
      const existing = readParticipantConditionIds(
        txnDb,
        input.campaignId,
        projection.target,
      );
      // A collision with a projection the concentration replacement is about
      // to remove is not a collision: validation sees post-replacement state.
      if (
        existing.includes(projection.condition.id) &&
        !replacementRemovals.has(key)
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

    // ---- writes ----

    // Concentration replacement: starting to concentrate ends the prior
    // concentration effect deterministically (SRD concentration).
    let replaced: CreateActiveEffectResult['replaced'];
    if (priorConcentration !== undefined) {
      const cleanup = finalizeEnd(
        txnDb,
        priorConcentration,
        {
          reason: 'concentration-broken',
          detail: 'new-concentration',
          note: `replaced by effect '${input.effectId}'`,
        },
        input,
      );
      replaced = {
        effectId: priorConcentration.effect_id,
        displayName: priorConcentration.display_name,
        cleanup,
      };
    }

    txnDb
      .prepare(
        `INSERT INTO active_effect(
           campaign_id, effect_id, kind, display_name, source_kind,
           source_ref, source_actor_kind, source_actor_ref,
           requires_concentration, concentration_owner_kind,
           concentration_owner_ref, duration_kind, duration_amount,
           duration_unit, anchor_kind, anchor_at, anchor_game_time,
           anchor_combat_instance_id, anchor_round, expiry_trigger,
           dismissible, status, created_at, provenance, session_id,
           updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                 ?, 'active', ?, ?, ?, ?)`,
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
        duration.anchorCombatInstanceId,
        duration.anchorRound,
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
         projection_ref, cleanup_on_end, cleanup_on_break, status,
         provenance, session_id, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
    );

    for (const projection of conditions) {
      if (projection.target.kind === 'character') {
        addCondition(txnDb, projection.condition, {
          provenance: input.provenance,
          sessionId: input.sessionId,
          at: input.at,
          characterId: projection.target.ref,
        });
      } else {
        updateCombatant(txnDb, {
          campaignId: input.campaignId,
          combatantId: projection.target.ref,
          addCondition: projection.condition,
          provenance: input.provenance,
          sessionId: input.sessionId,
          at: input.at,
        });
      }
      insertLink.run(
        input.campaignId,
        input.effectId,
        'condition',
        projection.target.kind,
        projection.target.ref,
        projection.condition.id,
        projection.cleanupOnEnd ?? 'remove',
        projection.cleanupOnBreak ?? 'remove',
        input.provenance,
        input.sessionId,
        input.at,
      );
    }

    for (const actor of actors) {
      insertLink.run(
        input.campaignId,
        input.effectId,
        'actor',
        'combatant',
        actor.combatantId,
        actor.combatantId,
        actor.cleanupOnEnd ?? 'remove',
        actor.cleanupOnBreak ?? 'remove',
        input.provenance,
        input.sessionId,
        input.at,
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

    const cleanup = finalizeEnd(
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
      changed: true,
      effect: requireEffectView(txnDb, input.campaignId, input.effectId),
      cleanup,
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
      cleanup = finalizeEnd(
        txnDb,
        row,
        { reason: 'concentration-broken', detail: 'damage-save-failed' },
        input,
      );
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
  for (const row of rows) {
    finalizeEnd(
      db,
      row,
      { reason: 'concentration-broken', detail: cause },
      ctx,
    );
  }
  return {
    broken: true,
    effectId: rows[0]?.effect_id,
    displayName: rows[0]?.display_name,
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
  cause: 'incapacitated' | 'dead',
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
  finalizeEnd(db, row, { reason: 'concentration-broken', detail: cause }, ctx);
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

    // Partial multi-target cleanup: exactly this target's owned projections.
    const actions: EffectCleanupAction[] = [];
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
        const action =
          link.cleanup_on_end === 'release'
            ? 'released'
            : removeProjection(txnDb, input.campaignId, link, input);
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
    }

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

    return {
      changed: true,
      effect: requireEffectView(txnDb, input.campaignId, input.effectId),
      cleanup: actions,
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
    );
    // A refreshed duration is grounded the same way a created one is: a
    // spell record's parseable duration binds the refresh too.
    if (
      input.duration !== undefined &&
      row.source_kind === 'spell' &&
      row.source_ref !== null
    ) {
      const record = lookupCampaignRecord(txnDb, 'spell', row.source_ref);
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

    const previous = durationView(row);
    txnDb
      .prepare(
        `UPDATE active_effect
         SET duration_kind = ?, duration_amount = ?, duration_unit = ?,
             anchor_kind = ?, anchor_at = ?, anchor_game_time = ?,
             anchor_combat_instance_id = ?, anchor_round = ?,
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
        duration.anchorCombatInstanceId,
        duration.anchorRound,
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
    parts.push(`${d.amount} ${d.unit}(s) from ${d.anchorKind}${rounds}`);
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

export interface ExpiredEffectSummary {
  readonly effectId: string;
  readonly displayName: string;
  readonly deadlineRound: number;
  readonly cleanup: EffectCleanupSummary;
}

/**
 * Deterministic round-deadline sweep: end every live round-unit timed effect
 * whose anchoring combat instance has reached or passed its deadline round.
 * Idempotent — already-ended effects are simply no longer live.
 */
export function expireElapsedRoundEffects(
  db: Db,
  input: ExpireElapsedRoundEffectsInput,
): ExpiredEffectSummary[] {
  return withTransaction(db, (txnDb) => {
    const rows = txnDb
      .prepare(
        `SELECT ${EFFECT_COLUMNS} FROM active_effect
         WHERE campaign_id = ? AND status IN ('active', 'suppressed')
           AND duration_kind = 'timed' AND duration_unit = 'round'
         ORDER BY created_at, effect_id`,
      )
      .all(input.campaignId) as ActiveEffectRow[];
    const expired: ExpiredEffectSummary[] = [];
    for (const row of rows) {
      const deadline = deadlineRound(row);
      if (deadline === undefined || row.anchor_combat_instance_id === null) {
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
      const cleanup = finalizeEnd(
        txnDb,
        row,
        {
          reason: 'expired',
          note: `round deadline ${deadline} reached (round ${instance.round_number})`,
        },
        input,
      );
      expired.push({
        effectId: row.effect_id,
        displayName: row.display_name,
        deadlineRound: deadline,
        cleanup,
      });
    }
    return expired;
  });
}
