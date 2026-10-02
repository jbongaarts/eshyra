import type { AdventureModule } from '../adventure/types.js';
import { rollDice } from '../orchestrator/dice.js';
import { createSeededRng, type Rng } from '../orchestrator/rng.js';
import type { Db } from '../persistence/db.js';
import { withTransaction } from '../persistence/db.js';
import type { RulesRecord } from '../rules/types.js';
// Function-level circular dependency with activeEffects.ts (which mutates
// combatants through updateCombatant during effect cleanup): safe because
// both sides only reference each other inside function bodies, never during
// module evaluation. The reaction lives here, not in the tool wrapper, so
// EVERY updateCombatant caller gets the atomic incapacitation invariant.
import {
  anyConditionImpliesIncapacitated,
  applyCombatClosureToEffects,
  breakCombatantConcentration,
} from './activeEffects.js';
import {
  type CampaignRulesPackResolver,
  lookupCampaignRecord,
} from './campaignRecordLookup.js';
import { effectiveHpMax } from './exhaustion.js';
import { resolveDeathSaveTransition } from './hpLifecycle.js';
import type { CharacterConditionEntry, JsonValue } from './liveStateSchema.js';
import { closeOpenShortRestRecoveryWindows } from './rest.js';

export type CombatInstanceStatus =
  | 'active'
  | 'completed'
  | 'abandoned'
  | 'fled'
  | 'interrupted';

export type ActorKind = 'npc' | 'creature' | 'monster' | 'companion' | 'other';
export type ActorSourceKind =
  | 'module_npc'
  | 'module_creature'
  | 'encounter_instance'
  | 'campaign_created';
export type ActorStatus =
  | 'alive'
  | 'dead'
  | 'unconscious'
  | 'escaped'
  | 'inactive'
  | 'unknown'
  | 'dying'
  | 'stable';
export type CombatantIdentityKind =
  | 'encounter_instance'
  | 'module_npc'
  | 'module_creature'
  | 'campaign_actor';
export type CombatantStatus =
  | 'alive'
  | 'dead'
  | 'unconscious'
  | 'escaped'
  | 'inactive'
  | 'dying'
  | 'stable';

export interface CombatInstance {
  readonly campaignId: string;
  readonly combatInstanceId: string;
  readonly sourceEncounterId: string | undefined;
  readonly sourceRunId: string | undefined;
  readonly status: CombatInstanceStatus;
  readonly locationId: string | undefined;
  readonly sessionId: string;
  readonly openedAt: string;
  readonly updatedAt: string;
  readonly closedAt: string | undefined;
}

export interface CampaignActor {
  readonly campaignId: string;
  readonly actorId: string;
  readonly displayName: string;
  readonly actorKind: ActorKind;
  readonly sourceKind: ActorSourceKind;
  readonly sourceRef: string | undefined;
  readonly rulesRef: string | undefined;
  readonly hpCurrent: number | undefined;
  readonly hpMax: number | undefined;
  readonly conditions: readonly CharacterConditionEntry[];
  readonly status: ActorStatus;
  readonly currentLocationId: string | undefined;
  readonly state: Record<string, JsonValue>;
}

export interface EncounterCombatant {
  readonly campaignId: string;
  readonly combatInstanceId: string;
  readonly sourceEncounterId: string | undefined;
  readonly combatantId: string;
  readonly identityKind: CombatantIdentityKind;
  readonly identityRef: string | undefined;
  readonly displayLabel: string;
  readonly rulesRef: string;
  readonly side: string;
  readonly faction: string | undefined;
  readonly hpCurrent: number;
  readonly hpMax: number;
  readonly ac: number | undefined;
  readonly conditions: readonly CharacterConditionEntry[];
  readonly status: CombatantStatus;
  readonly locationId: string | undefined;
  readonly placement: string | undefined;
  readonly deathRules: 'monster' | 'player-character';
  readonly deathSaveSuccesses: number;
  readonly deathSaveFailures: number;
  readonly recoveryBlock: 'suffocating' | null;
  readonly stableRecoveryRoll: number | null;
  readonly stableRecoveryAnchorElapsedMinutes: number | null;
  readonly stableRecoveryDeadlineElapsedMinutes: number | null;
  /** Current creature head count when its record has a multipleHeads mechanic. */
  readonly headCount: number | null;
}

export interface UpsertCampaignActorInput {
  readonly campaignId: string;
  readonly actorId: string;
  readonly displayName: string;
  readonly actorKind: ActorKind;
  readonly sourceKind: ActorSourceKind;
  readonly sourceRef?: string;
  readonly rulesRef?: string;
  readonly hpCurrent?: number;
  readonly hpMax?: number;
  readonly conditions?: readonly CharacterConditionEntry[];
  readonly status?: ActorStatus;
  readonly currentLocationId?: string;
  readonly state?: Record<string, JsonValue>;
  readonly provenance: string;
  readonly sessionId: string;
  readonly at: string;
}

export interface StartEncounterActorInput {
  readonly actorId: string;
  readonly displayName?: string;
  readonly actorKind?: ActorKind;
  readonly sourceKind?: ActorSourceKind;
  readonly sourceRef?: string;
  readonly rulesRef?: string;
  readonly hpCurrent?: number;
  readonly hpMax?: number;
  readonly conditions?: readonly CharacterConditionEntry[];
  readonly status?: ActorStatus;
  readonly currentLocationId?: string;
  readonly state?: Record<string, JsonValue>;
  readonly side?: string;
  readonly faction?: string;
  readonly placement?: string;
}

export interface StartEncounterInput {
  readonly campaignId: string;
  readonly encounterId?: string;
  readonly combatInstanceId?: string;
  readonly runId?: string;
  readonly locationId?: string;
  readonly actors?: readonly StartEncounterActorInput[];
  readonly resolveAdventureModule?: (
    moduleId: string,
  ) => AdventureModule | undefined;
  readonly resolveRulesPack?: CampaignRulesPackResolver;
  readonly provenance: string;
  readonly sessionId: string;
  readonly at: string;
}

export interface StartEncounterResult {
  readonly started: boolean;
  readonly combatInstance: CombatInstance;
  readonly combatants: readonly EncounterCombatant[];
}

export interface CloseCombatInstanceInput {
  readonly campaignId: string;
  readonly combatInstanceId?: string;
  readonly status: Exclude<CombatInstanceStatus, 'active'>;
  readonly provenance: string;
  readonly sessionId: string;
  readonly at: string;
}

export interface UpdateCombatantInput {
  readonly campaignId: string;
  readonly combatantId: string;
  readonly hpDelta?: number;
  /** Declared damage types returned by resolve_damage for a negative hpDelta. */
  readonly damageTypes?: readonly string[];
  readonly resolveRulesPack?: CampaignRulesPackResolver;
  readonly deathRules?: 'player-character';
  readonly critical?: boolean;
  /** Seeds the stable-recovery deadline when a knockout makes the combatant stable. */
  readonly rng?: Rng;
  readonly addCondition?: CharacterConditionEntry;
  /** Internal atomic condition replacement used by engine-owned transitions. */
  readonly replaceConditions?: readonly CharacterConditionEntry[];
  readonly removeCondition?: string;
  readonly status?: CombatantStatus;
  readonly locationId?: string;
  readonly placement?: string;
  readonly provenance: string;
  readonly sessionId: string;
  readonly at: string;
}

export interface CampaignActorMutationInput {
  readonly campaignId: string;
  readonly actorId: string;
  readonly addCondition?: CharacterConditionEntry;
  readonly removeCondition?: string;
  readonly status?: ActorStatus;
  readonly hpCurrent?: number;
  readonly hpMax?: number;
  readonly currentLocationId?: string;
  readonly provenance: string;
  readonly sessionId: string;
  readonly at: string;
}

/** Semantic actor mutation seam. It preserves unrelated durable state and
 * mirrors changes into the active projection, when one exists. */
export function updateCampaignActor(
  db: Db,
  input: CampaignActorMutationInput,
): CampaignActor {
  return withTransaction(db, (txnDb) => {
    const actor = getCampaignActor(txnDb, input.campaignId, input.actorId);
    if (actor === undefined) {
      throw new EncounterCombatantError(
        `unknown campaign actor '${input.actorId}'`,
      );
    }
    const conditions = [...actor.conditions];
    if (
      input.addCondition !== undefined &&
      !conditions.some((c) => c.id === input.addCondition?.id)
    ) {
      conditions.push(input.addCondition);
    }
    if (input.removeCondition !== undefined) {
      conditions.splice(
        0,
        conditions.length,
        ...conditions.filter((c) => c.id !== input.removeCondition),
      );
    }
    upsertCampaignActor(txnDb, {
      campaignId: input.campaignId,
      actorId: input.actorId,
      displayName: actor.displayName,
      actorKind: actor.actorKind,
      sourceKind: actor.sourceKind,
      sourceRef: actor.sourceRef,
      rulesRef: actor.rulesRef,
      hpCurrent: input.hpCurrent ?? actor.hpCurrent,
      hpMax: input.hpMax ?? actor.hpMax,
      conditions,
      status: input.status ?? actor.status,
      currentLocationId: input.currentLocationId ?? actor.currentLocationId,
      state: actor.state,
      provenance: input.provenance,
      sessionId: input.sessionId,
      at: input.at,
    });
    const projection = txnDb
      .prepare(
        `SELECT combatant_id, hp_current FROM encounter_combatant
         WHERE campaign_id = ? AND identity_kind = 'campaign_actor' AND identity_ref = ?
           AND combat_instance_id IN (SELECT combat_instance_id FROM combat_instance WHERE campaign_id = ? AND status = 'active')
         ORDER BY combatant_id LIMIT 1`,
      )
      .get(input.campaignId, input.actorId, input.campaignId) as
      | { combatant_id: string; hp_current: number }
      | undefined;
    if (projection !== undefined) {
      if (input.hpMax !== undefined) {
        txnDb
          .prepare(
            `UPDATE encounter_combatant SET hp_max = ?, provenance = ?, session_id = ?, updated_at = ?
             WHERE campaign_id = ? AND combatant_id = ?`,
          )
          .run(
            input.hpMax,
            input.provenance,
            input.sessionId,
            input.at,
            input.campaignId,
            projection.combatant_id,
          );
      }
      updateCombatant(txnDb, {
        campaignId: input.campaignId,
        combatantId: projection.combatant_id,
        ...(input.hpCurrent === undefined
          ? {}
          : { hpDelta: input.hpCurrent - projection.hp_current }),
        ...(input.addCondition === undefined
          ? {}
          : { addCondition: input.addCondition }),
        ...(input.removeCondition === undefined
          ? {}
          : { removeCondition: input.removeCondition }),
        ...(input.status === undefined || input.status === 'unknown'
          ? {}
          : { status: input.status }),
        ...(input.currentLocationId === undefined
          ? {}
          : { locationId: input.currentLocationId }),
        provenance: input.provenance,
        sessionId: input.sessionId,
        at: input.at,
      });
    }
    const updated = getCampaignActor(txnDb, input.campaignId, input.actorId);
    if (updated === undefined) {
      throw new EncounterCombatantError('campaign actor update failed');
    }
    return updated;
  });
}

export function ensureCampaignActorFromCombatant(
  db: Db,
  input: {
    campaignId: string;
    combatantId: string;
    actorId: string;
    provenance: string;
    sessionId: string;
    at: string;
  },
): CampaignActor {
  const combatant = readCombatant(db, input.campaignId, input.combatantId);
  if (combatant === undefined)
    throw new EncounterCombatantError(
      `unknown combatant '${input.combatantId}'`,
    );
  const existing = getCampaignActor(db, input.campaignId, input.actorId);
  if (
    existing !== undefined &&
    existing.rulesRef !== undefined &&
    existing.rulesRef !== combatant.rulesRef
  ) {
    throw new EncounterCombatantError(
      `campaign actor '${input.actorId}' has incompatible rules reference`,
    );
  }
  return upsertCampaignActor(db, {
    campaignId: input.campaignId,
    actorId: input.actorId,
    displayName: existing?.displayName ?? combatant.displayLabel,
    actorKind: existing?.actorKind ?? 'creature',
    sourceKind: existing?.sourceKind ?? 'campaign_created',
    sourceRef: existing?.sourceRef,
    rulesRef: combatant.rulesRef,
    hpCurrent: combatant.hpCurrent,
    hpMax: combatant.hpMax,
    conditions: combatant.conditions,
    status: combatant.status,
    currentLocationId: combatant.locationId,
    state: existing?.state,
    provenance: input.provenance,
    sessionId: input.sessionId,
    at: input.at,
  });
}

export interface UpdateCombatantResult {
  readonly combatant: EncounterCombatant;
  readonly syncedActor: CampaignActor | undefined;
  readonly previousHp: number;
  readonly hpDelta: number | undefined;
  readonly conditionAdded: boolean;
  readonly conditionRemoved: boolean;
  /** Set when this update downed or removed the combatant while it was
   *  concentrating: the F3 break + owned-projection cleanup happened in
   *  this transaction ('owner-removed' = transitioned to inactive). */
  readonly concentrationBroken?: {
    readonly effectId: string;
    readonly displayName: string;
    readonly cause: 'incapacitated' | 'dead' | 'owner-removed';
  };
}

export interface CombatantHeadRegrowthResult {
  readonly combatantId: string;
  readonly headsRegrown: number;
  readonly hitPointsRegained: number;
  readonly headCount: number;
}

/** Settle Multiple Heads when beginTurn implicitly ends the combatant's turn. */
export function settleCombatantHeadsAtTurnEnd(
  db: Db,
  input: {
    readonly campaignId: string;
    readonly combatantId: string;
    readonly resolveRulesPack?: CampaignRulesPackResolver;
    readonly provenance: string;
    readonly sessionId: string;
    readonly at: string;
  },
): CombatantHeadRegrowthResult | undefined {
  const combatant = readCombatant(db, input.campaignId, input.combatantId);
  if (combatant === undefined) return undefined;
  const mechanic = multipleHeadsMechanic(
    lookupCampaignRecord(
      db,
      'creature',
      combatant.rulesRef,
      input.resolveRulesPack,
    ),
  );
  if (mechanic === undefined) return undefined;
  if (combatant.headCount === null)
    throw new EncounterCombatantError(
      "this combatant's head count is unknown because its encounter began before head tracking; close the combat instance and start it again",
    );
  const counters = db
    .prepare(
      `SELECT heads_died_since_own_turn, fire_damage_since_own_turn
     FROM encounter_combatant WHERE campaign_id = ? AND combatant_id = ?`,
    )
    .get(input.campaignId, input.combatantId) as {
    heads_died_since_own_turn: number;
    fire_damage_since_own_turn: number;
  };
  const count = counters.heads_died_since_own_turn;
  const canRegrow =
    count > 0 &&
    counters.fire_damage_since_own_turn === 0 &&
    combatant.status !== 'dead';
  const headsRegrown = canRegrow ? count * mechanic.headsRegrownPerDeadHead : 0;
  const headCount = combatant.headCount + headsRegrown;
  db.prepare(
    `UPDATE encounter_combatant
     SET head_count = ?, heads_died_since_own_turn = 0,
         fire_damage_since_own_turn = 0, damage_this_turn = 0,
         damage_turn_key = NULL, head_died_this_turn = 0
     WHERE campaign_id = ? AND combatant_id = ?`,
  ).run(headCount, input.campaignId, input.combatantId);
  if (
    headsRegrown > 0 &&
    hasOnePerHeadReaction(
      lookupCampaignRecord(
        db,
        'creature',
        combatant.rulesRef,
        input.resolveRulesPack,
      ),
    )
  ) {
    db.prepare(
      `UPDATE combat_turn_budget SET reaction_allowance = ?,
         provenance = ?, session_id = ?, updated_at = ?
       WHERE campaign_id = ? AND combat_instance_id = ?
         AND participant_kind = 'combatant' AND participant_ref = ?`,
    ).run(
      Math.max(1, headCount),
      input.provenance,
      input.sessionId,
      input.at,
      input.campaignId,
      combatant.combatInstanceId,
      input.combatantId,
    );
  }
  const requestedHealing = headsRegrown * mechanic.hitPointsPerRegrownHead;
  let hitPointsRegained = 0;
  if (requestedHealing > 0 && combatant.recoveryBlock === null) {
    const healed = updateCombatant(db, {
      campaignId: input.campaignId,
      combatantId: input.combatantId,
      hpDelta: requestedHealing,
      resolveRulesPack: input.resolveRulesPack,
      provenance: input.provenance,
      sessionId: input.sessionId,
      at: input.at,
    });
    hitPointsRegained = healed.combatant.hpCurrent - healed.previousHp;
  }
  return headsRegrown === 0
    ? undefined
    : {
        combatantId: input.combatantId,
        headsRegrown,
        hitPointsRegained,
        headCount,
      };
}

export class EncounterCombatantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EncounterCombatantError';
  }
}

function requireActiveCombatant(
  db: Db,
  campaignId: string,
  c: EncounterCombatant | undefined,
): asserts c is EncounterCombatant {
  if (!c) throw new EncounterCombatantError('unknown combatant');
  if (
    readCombatInstance(db, campaignId, c.combatInstanceId)?.status !== 'active'
  )
    throw new EncounterCombatantError(
      `combatant '${c.combatantId}' belongs to inactive combat instance '${c.combatInstanceId}'`,
    );
}

function isCurrentActorProjection(
  db: Db,
  campaignId: string,
  actorId: string,
  combatantId: string,
): boolean {
  const row = db
    .prepare(`SELECT c.combatant_id FROM encounter_combatant c JOIN combat_instance i USING(campaign_id,combat_instance_id)
    WHERE c.campaign_id=? AND c.identity_kind='campaign_actor' AND c.identity_ref=?
    ORDER BY i.opened_at DESC,c.combat_instance_id DESC,c.combatant_id DESC LIMIT 1`)
    .get(campaignId, actorId) as { combatant_id: string } | undefined;
  return row?.combatant_id === combatantId;
}

interface AdventureRunRow {
  readonly run_id: string;
  readonly module_id: string;
}

interface CombatInstanceRow {
  readonly campaign_id: string;
  readonly combat_instance_id: string;
  readonly source_encounter_id: string | null;
  readonly source_run_id: string | null;
  readonly status: string;
  readonly location_id: string | null;
  readonly session_id: string;
  readonly opened_at: string;
  readonly updated_at: string;
  readonly closed_at: string | null;
}

interface ActorRow {
  readonly campaign_id: string;
  readonly actor_id: string;
  readonly display_name: string;
  readonly actor_kind: string;
  readonly source_kind: string;
  readonly source_ref: string | null;
  readonly rules_ref: string | null;
  readonly hp_current: number | null;
  readonly hp_max: number | null;
  readonly conditions_json: string;
  readonly status: string;
  readonly current_location_id: string | null;
  readonly state_json: string;
}

interface CombatantRow {
  readonly campaign_id: string;
  readonly combat_instance_id: string;
  readonly source_encounter_id: string | null;
  readonly combatant_id: string;
  readonly identity_kind: string;
  readonly identity_ref: string | null;
  readonly display_label: string;
  readonly rules_ref: string;
  readonly side: string;
  readonly faction: string | null;
  readonly hp_current: number;
  readonly hp_max: number;
  readonly ac: number | null;
  readonly conditions_json: string;
  readonly status: string;
  readonly location_id: string | null;
  readonly placement: string | null;
  readonly death_rules: 'monster' | 'player-character';
  readonly death_save_successes: number;
  readonly death_save_failures: number;
  readonly recovery_block: 'suffocating' | null;
  readonly stable_recovery_roll: number | null;
  readonly stable_recovery_anchor_elapsed_minutes: number | null;
  readonly stable_recovery_deadline_elapsed_minutes: number | null;
  readonly head_count: number | null;
}

function rowToCombatInstance(row: CombatInstanceRow): CombatInstance {
  return {
    campaignId: row.campaign_id,
    combatInstanceId: row.combat_instance_id,
    sourceEncounterId: row.source_encounter_id ?? undefined,
    sourceRunId: row.source_run_id ?? undefined,
    status: row.status as CombatInstanceStatus,
    locationId: row.location_id ?? undefined,
    sessionId: row.session_id,
    openedAt: row.opened_at,
    updatedAt: row.updated_at,
    closedAt: row.closed_at ?? undefined,
  };
}

function rowToActor(row: ActorRow): CampaignActor {
  let state: Record<string, JsonValue>;
  try {
    const parsed: unknown = JSON.parse(row.state_json);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
      throw new Error('state_json root must be an object');
    state = parsed as Record<string, JsonValue>;
  } catch {
    throw new EncounterCombatantError('campaign actor state_json is malformed');
  }
  readCombatLifecycle(state);
  return {
    campaignId: row.campaign_id,
    actorId: row.actor_id,
    displayName: row.display_name,
    actorKind: row.actor_kind as ActorKind,
    sourceKind: row.source_kind as ActorSourceKind,
    sourceRef: row.source_ref ?? undefined,
    rulesRef: row.rules_ref ?? undefined,
    hpCurrent: row.hp_current ?? undefined,
    hpMax: row.hp_max ?? undefined,
    conditions: JSON.parse(row.conditions_json) as CharacterConditionEntry[],
    status: row.status as ActorStatus,
    currentLocationId: row.current_location_id ?? undefined,
    state,
  };
}

interface CombatLifecycle {
  deathRules: 'monster' | 'player-character';
  deathSaveSuccesses: number;
  deathSaveFailures: number;
  recoveryBlock: 'suffocating' | null;
  stableRecovery: { roll: number; anchor: number; deadline: number } | null;
  headCount: number | null;
}

function readCombatLifecycle(
  state: Record<string, JsonValue>,
): CombatLifecycle | undefined {
  const value = state.combatLifecycle;
  if (value === undefined) return undefined;
  const fail = (): never => {
    throw new EncounterCombatantError(
      'campaign actor combatLifecycle state is malformed',
    );
  };
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return fail();
  const v = value as Record<string, JsonValue>;
  if (
    (v.deathRules !== 'monster' && v.deathRules !== 'player-character') ||
    !Number.isInteger(v.deathSaveSuccesses) ||
    (v.deathSaveSuccesses as number) < 0 ||
    (v.deathSaveSuccesses as number) > 3 ||
    !Number.isInteger(v.deathSaveFailures) ||
    (v.deathSaveFailures as number) < 0 ||
    (v.deathSaveFailures as number) > 3 ||
    (v.recoveryBlock !== null && v.recoveryBlock !== 'suffocating') ||
    (v.headCount !== null &&
      (!Number.isInteger(v.headCount) || (v.headCount as number) < 0))
  )
    return fail();
  let stableRecovery: CombatLifecycle['stableRecovery'] = null;
  if (v.stableRecovery !== null) {
    if (typeof v.stableRecovery !== 'object' || Array.isArray(v.stableRecovery))
      return fail();
    const s = v.stableRecovery as Record<string, JsonValue>;
    if (
      !Number.isInteger(s.roll) ||
      !Number.isInteger(s.anchor) ||
      !Number.isInteger(s.deadline)
    )
      return fail();
    stableRecovery = {
      roll: s.roll as number,
      anchor: s.anchor as number,
      deadline: s.deadline as number,
    };
  }
  return {
    deathRules: v.deathRules,
    deathSaveSuccesses: v.deathSaveSuccesses as number,
    deathSaveFailures: v.deathSaveFailures as number,
    recoveryBlock: v.recoveryBlock,
    stableRecovery,
    headCount: v.headCount as number | null,
  };
}

function rowToCombatant(row: CombatantRow): EncounterCombatant {
  return {
    campaignId: row.campaign_id,
    combatInstanceId: row.combat_instance_id,
    sourceEncounterId: row.source_encounter_id ?? undefined,
    combatantId: row.combatant_id,
    identityKind: row.identity_kind as CombatantIdentityKind,
    identityRef: row.identity_ref ?? undefined,
    displayLabel: row.display_label,
    rulesRef: row.rules_ref,
    side: row.side,
    faction: row.faction ?? undefined,
    hpCurrent: row.hp_current,
    hpMax: row.hp_max,
    ac: row.ac ?? undefined,
    conditions: JSON.parse(row.conditions_json) as CharacterConditionEntry[],
    status: row.status as CombatantStatus,
    locationId: row.location_id ?? undefined,
    placement: row.placement ?? undefined,
    deathRules: row.death_rules,
    deathSaveSuccesses: row.death_save_successes,
    deathSaveFailures: row.death_save_failures,
    recoveryBlock: row.recovery_block,
    stableRecoveryRoll: row.stable_recovery_roll,
    stableRecoveryAnchorElapsedMinutes:
      row.stable_recovery_anchor_elapsed_minutes,
    stableRecoveryDeadlineElapsedMinutes:
      row.stable_recovery_deadline_elapsed_minutes,
    headCount: row.head_count,
  };
}

function slug(value: string): string {
  const normalized = value.toLowerCase();
  let start = 0;
  let prefixEnd = 0;
  while (prefixEnd < normalized.length) {
    const code = normalized.charCodeAt(prefixEnd);
    if (code < 97 || code > 122) break;
    prefixEnd += 1;
  }
  if (prefixEnd > 0 && normalized[prefixEnd] === ':') {
    start = prefixEnd + 1;
  }

  let result = '';
  let pendingSeparator = false;
  for (let i = start; i < normalized.length; i += 1) {
    const code = normalized.charCodeAt(i);
    const isDigit = code >= 48 && code <= 57;
    const isAsciiLetter = code >= 97 && code <= 122;
    if (isDigit || isAsciiLetter) {
      if (pendingSeparator && result.length > 0) {
        result += '-';
      }
      result += normalized[i];
      pendingSeparator = false;
    } else {
      pendingSeparator = true;
    }
  }

  return result || 'combat';
}

function displayNameFromRulesRef(rulesRef: string): string {
  return slug(rulesRef)
    .split('-')
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ');
}

function lookupCreatureRecord(
  db: Db,
  rulesRef: string,
  resolver?: CampaignRulesPackResolver,
): RulesRecord | undefined {
  return lookupCampaignRecord(db, 'creature', rulesRef, resolver);
}

/**
 * Read a creature's base armor class. SRD packs since eshyra-o9bd.18.6 model
 * `armorClass` as a structured `{ value, … }` statline object; older/other
 * packs may still carry a bare integer, so both shapes are accepted (mirrors
 * `readCreatureHp`).
 */
function readCreatureAc(record: RulesRecord | undefined): number | undefined {
  const data = record?.data;
  if (typeof data !== 'object' || data === null) return undefined;
  const ac = (data as Record<string, unknown>).armorClass;
  if (typeof ac === 'number' && Number.isInteger(ac)) return ac;
  if (typeof ac !== 'object' || ac === null) return undefined;
  const value = (ac as Record<string, unknown>).value;
  return typeof value === 'number' && Number.isInteger(value)
    ? value
    : undefined;
}

function initialHeadCount(record: RulesRecord | undefined): number | undefined {
  const visit = (value: unknown): number | undefined => {
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = visit(item);
        if (found !== undefined) return found;
      }
    } else if (typeof value === 'object' && value !== null) {
      const candidate = value as Record<string, unknown>;
      if (candidate.kind === 'multipleHeads') {
        return typeof candidate.initialHeads === 'number'
          ? candidate.initialHeads
          : undefined;
      }
      for (const nested of Object.values(candidate)) {
        const found = visit(nested);
        if (found !== undefined) return found;
      }
    }
    return undefined;
  };
  return visit(record?.data);
}

interface MultipleHeadsMechanic {
  readonly initialHeads: number;
  readonly headDiesWhenDamageInOneTurnAtLeast: number;
  readonly headsRegrownPerDeadHead: number;
  readonly regrowthSuppressedByDamageType: string;
  readonly hitPointsPerRegrownHead: number;
  readonly deathWhenNoHeads: boolean;
}

function multipleHeadsMechanic(
  record: RulesRecord | undefined,
): MultipleHeadsMechanic | undefined {
  const visit = (value: unknown): MultipleHeadsMechanic | undefined => {
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = visit(item);
        if (found !== undefined) return found;
      }
    } else if (typeof value === 'object' && value !== null) {
      const candidate = value as Record<string, unknown>;
      if (candidate.kind === 'multipleHeads') {
        return candidate as unknown as MultipleHeadsMechanic;
      }
      for (const nested of Object.values(candidate)) {
        const found = visit(nested);
        if (found !== undefined) return found;
      }
    }
    return undefined;
  };
  return visit(record?.data);
}

function hasOnePerHeadReaction(record: RulesRecord | undefined): boolean {
  const visit = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.some(visit);
    if (typeof value !== 'object' || value === null) return false;
    const candidate = value as Record<string, unknown>;
    if (
      candidate.kind === 'extraReactions' &&
      candidate.formula === 'one-per-head-beyond-one'
    )
      return true;
    return Object.values(candidate).some(visit);
  };
  return visit(record?.data);
}

function readCreatureHp(record: RulesRecord | undefined): number {
  const data = record?.data;
  if (typeof data !== 'object' || data === null) return 1;
  const hp = (data as Record<string, unknown>).hitPoints;
  if (typeof hp === 'number' && Number.isInteger(hp) && hp >= 0) return hp;
  if (typeof hp !== 'object' || hp === null) return 1;
  const value = (hp as Record<string, unknown>).value;
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : 1;
}

function activeInstance(db: Db, campaignId: string) {
  const row = db
    .prepare(
      `SELECT campaign_id, combat_instance_id, source_encounter_id,
              source_run_id, status, location_id, session_id, opened_at,
              updated_at, closed_at
       FROM combat_instance
       WHERE campaign_id = ? AND status = 'active'
       ORDER BY opened_at DESC
       LIMIT 1`,
    )
    .get(campaignId) as CombatInstanceRow | undefined;
  return row === undefined ? undefined : rowToCombatInstance(row);
}

function requireNoActiveInstance(db: Db, campaignId: string) {
  const active = activeInstance(db, campaignId);
  if (active !== undefined) {
    throw new EncounterCombatantError(
      `combat instance '${active.combatInstanceId}' is already active; close or interrupt it before starting another`,
    );
  }
}

function nextCombatInstanceId(
  db: Db,
  campaignId: string,
  sourceEncounterId: string | undefined,
): string {
  const base = `ci-${slug(sourceEncounterId ?? 'combat')}`;
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM combat_instance
       WHERE campaign_id = ? AND combat_instance_id LIKE ?`,
    )
    .get(campaignId, `${base}-%`) as { n: number };
  return `${base}-${row.n + 1}`;
}

function readActiveAdventureRuns(
  db: Db,
  campaignId: string,
  runId: string | undefined,
): AdventureRunRow[] {
  const sql =
    runId === undefined
      ? `SELECT run_id, module_id
         FROM adventure_run
         WHERE campaign_id = ? AND status = 'active'
         ORDER BY run_id`
      : `SELECT run_id, module_id
         FROM adventure_run
         WHERE campaign_id = ? AND run_id = ? AND status = 'active'
         ORDER BY run_id`;
  return (
    runId === undefined
      ? db.prepare(sql).all(campaignId)
      : db.prepare(sql).all(campaignId, runId)
  ) as AdventureRunRow[];
}

function findEncounterInActiveRun(db: Db, input: StartEncounterInput) {
  if (input.encounterId === undefined) return undefined;
  if (input.resolveAdventureModule === undefined) {
    throw new EncounterCombatantError(
      'start_encounter requires an active adventure module resolver',
    );
  }
  for (const run of readActiveAdventureRuns(
    db,
    input.campaignId,
    input.runId,
  )) {
    const module = input.resolveAdventureModule(run.module_id);
    const encounter = module?.encounters.find(
      (e) => e.id === input.encounterId,
    );
    if (module !== undefined && encounter !== undefined) {
      return { run, encounter };
    }
  }
  throw new EncounterCombatantError(
    `encounter '${input.encounterId}' was not found in an active adventure run`,
  );
}

export function getCampaignActor(
  db: Db,
  campaignId: string,
  actorId: string,
): CampaignActor | undefined {
  const row = db
    .prepare(
      `SELECT campaign_id, actor_id, display_name, actor_kind, source_kind,
              source_ref, rules_ref, hp_current, hp_max, conditions_json,
              status, current_location_id, state_json
       FROM campaign_actor
       WHERE campaign_id = ? AND actor_id = ?`,
    )
    .get(campaignId, actorId) as ActorRow | undefined;
  return row === undefined ? undefined : rowToActor(row);
}

export function upsertCampaignActor(
  db: Db,
  input: UpsertCampaignActorInput,
): CampaignActor {
  db.prepare(
    `INSERT INTO campaign_actor(
       campaign_id, actor_id, display_name, actor_kind, source_kind, source_ref,
       rules_ref, hp_current, hp_max, conditions_json, status,
       current_location_id, state_json, provenance, session_id, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(campaign_id, actor_id) DO UPDATE SET
       display_name = excluded.display_name,
       actor_kind = excluded.actor_kind,
       source_kind = excluded.source_kind,
       source_ref = excluded.source_ref,
       rules_ref = excluded.rules_ref,
       hp_current = excluded.hp_current,
       hp_max = excluded.hp_max,
       conditions_json = excluded.conditions_json,
       status = excluded.status,
       current_location_id = excluded.current_location_id,
       state_json = excluded.state_json,
       provenance = excluded.provenance,
       session_id = excluded.session_id,
       updated_at = excluded.updated_at`,
  ).run(
    input.campaignId,
    input.actorId,
    input.displayName,
    input.actorKind,
    input.sourceKind,
    input.sourceRef ?? null,
    input.rulesRef ?? null,
    input.hpCurrent ?? null,
    input.hpMax ?? null,
    JSON.stringify(input.conditions ?? []),
    input.status ?? 'unknown',
    input.currentLocationId ?? null,
    JSON.stringify(input.state ?? {}),
    input.provenance,
    input.sessionId,
    input.at,
  );
  const actor = getCampaignActor(db, input.campaignId, input.actorId);
  if (actor === undefined) {
    throw new EncounterCombatantError('campaign actor upsert failed');
  }
  return actor;
}

export function listCombatantsForInstance(
  db: Db,
  campaignId: string,
  combatInstanceId: string,
): EncounterCombatant[] {
  const rows = db
    .prepare(
      `SELECT campaign_id, combat_instance_id, source_encounter_id,
              combatant_id, identity_kind, identity_ref, display_label,
              rules_ref, side, faction, hp_current, hp_max, ac,
              conditions_json, status, location_id, placement, death_rules,
              death_save_successes, death_save_failures, recovery_block,
              stable_recovery_roll, stable_recovery_anchor_elapsed_minutes,
              stable_recovery_deadline_elapsed_minutes, head_count
       FROM encounter_combatant
       WHERE campaign_id = ? AND combat_instance_id = ?
       ORDER BY combatant_id`,
    )
    .all(campaignId, combatInstanceId) as CombatantRow[];
  return rows.map(rowToCombatant);
}

export function listCombatants(
  db: Db,
  campaignId: string,
): EncounterCombatant[] {
  const active = activeInstance(db, campaignId);
  return active === undefined
    ? []
    : listCombatantsForInstance(db, campaignId, active.combatInstanceId);
}

export function listCampaignActors(
  db: Db,
  campaignId: string,
): CampaignActor[] {
  const rows = db
    .prepare(
      `SELECT campaign_id, actor_id, display_name, actor_kind, source_kind,
              source_ref, rules_ref, hp_current, hp_max, conditions_json,
              status, current_location_id, state_json
       FROM campaign_actor
       WHERE campaign_id = ?
       ORDER BY actor_id`,
    )
    .all(campaignId) as ActorRow[];
  return rows.map(rowToActor);
}

function insertCombatant(
  db: Db,
  input: {
    campaignId: string;
    combatInstanceId: string;
    sourceEncounterId: string | undefined;
    combatantId: string;
    identityKind: CombatantIdentityKind;
    identityRef?: string;
    displayLabel: string;
    rulesRef: string;
    side: string;
    faction?: string;
    hpCurrent: number;
    hpMax: number;
    ac?: number;
    conditions?: readonly CharacterConditionEntry[];
    status: CombatantStatus;
    locationId?: string;
    placement?: string;
    headCount?: number;
    provenance: string;
    sessionId: string;
    at: string;
  },
) {
  db.prepare(
    `INSERT INTO encounter_combatant(
       campaign_id, combat_instance_id, source_encounter_id, combatant_id,
       identity_kind, identity_ref, display_label, rules_ref, side, faction,
       hp_current, hp_max, ac, conditions_json, status, location_id, placement,
       head_count, provenance, session_id, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.campaignId,
    input.combatInstanceId,
    input.sourceEncounterId ?? null,
    input.combatantId,
    input.identityKind,
    input.identityRef ?? null,
    input.displayLabel,
    input.rulesRef,
    input.side,
    input.faction ?? null,
    input.hpCurrent,
    input.hpMax,
    input.ac ?? null,
    JSON.stringify(input.conditions ?? []),
    input.status,
    input.locationId ?? null,
    input.placement ?? null,
    input.headCount ?? null,
    input.provenance,
    input.sessionId,
    input.at,
  );
}

export function startEncounter(
  db: Db,
  input: StartEncounterInput,
): StartEncounterResult {
  return withTransaction(db, (txnDb) => startEncounterInTxn(txnDb, input));
}

function startEncounterInTxn(
  db: Db,
  input: StartEncounterInput,
): StartEncounterResult {
  closeOpenShortRestRecoveryWindows(db, input.campaignId);
  requireNoActiveInstance(db, input.campaignId);
  const source = findEncounterInActiveRun(db, input);
  const combatInstanceId =
    input.combatInstanceId ??
    nextCombatInstanceId(db, input.campaignId, input.encounterId);
  const sourceRunId = input.runId ?? source?.run.run_id;
  const locationId = input.locationId ?? source?.encounter.locationId;

  db.prepare(
    `INSERT INTO combat_instance(
       campaign_id, combat_instance_id, source_encounter_id, source_run_id,
       status, location_id, provenance, session_id, opened_at, updated_at,
       closed_at
     )
     VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, NULL)`,
  ).run(
    input.campaignId,
    combatInstanceId,
    input.encounterId ?? null,
    sourceRunId ?? null,
    locationId ?? null,
    input.provenance,
    input.sessionId,
    input.at,
    input.at,
  );

  let ordinal = 1;
  for (const creature of source?.encounter.creatures ?? []) {
    const record = lookupCreatureRecord(
      db,
      creature.rulesRef,
      input.resolveRulesPack,
    );
    const hpMax = readCreatureHp(record);
    const ac = readCreatureAc(record);
    const baseId = slug(creature.rulesRef);
    const baseLabel =
      record?.name ?? displayNameFromRulesRef(creature.rulesRef);
    for (let i = 0; i < creature.count; i += 1) {
      insertCombatant(db, {
        campaignId: input.campaignId,
        combatInstanceId,
        sourceEncounterId: input.encounterId,
        combatantId: `${combatInstanceId}-${baseId}-${ordinal}`,
        identityKind: 'encounter_instance',
        displayLabel: creature.count > 1 ? `${baseLabel} ${i + 1}` : baseLabel,
        rulesRef: creature.rulesRef,
        side: 'enemy',
        faction: creature.role,
        hpCurrent: hpMax,
        hpMax,
        ac,
        status: 'alive',
        headCount: initialHeadCount(record),
        locationId,
        placement: creature.role,
        provenance: input.provenance,
        sessionId: input.sessionId,
        at: input.at,
      });
      ordinal += 1;
    }
  }

  for (const actorInput of input.actors ?? []) {
    const existing = getCampaignActor(db, input.campaignId, actorInput.actorId);
    const rulesRef = actorInput.rulesRef ?? existing?.rulesRef;
    if (rulesRef === undefined) {
      throw new EncounterCombatantError(
        `actor '${actorInput.actorId}' needs rulesRef for combat projection`,
      );
    }
    const record = lookupCreatureRecord(db, rulesRef, input.resolveRulesPack);
    const baselineHp = readCreatureHp(record);
    const hpMax = actorInput.hpMax ?? existing?.hpMax ?? baselineHp;
    const hpCurrent = actorInput.hpCurrent ?? existing?.hpCurrent ?? hpMax;
    const conditions = actorInput.conditions ?? existing?.conditions ?? [];
    const actor = upsertCampaignActor(db, {
      campaignId: input.campaignId,
      actorId: actorInput.actorId,
      displayName:
        actorInput.displayName ??
        existing?.displayName ??
        record?.name ??
        displayNameFromRulesRef(rulesRef),
      actorKind: actorInput.actorKind ?? existing?.actorKind ?? 'creature',
      sourceKind:
        actorInput.sourceKind ?? existing?.sourceKind ?? 'campaign_created',
      sourceRef: actorInput.sourceRef ?? existing?.sourceRef,
      rulesRef,
      hpCurrent,
      hpMax,
      conditions,
      status: actorInput.status ?? existing?.status ?? 'alive',
      currentLocationId:
        actorInput.currentLocationId ??
        existing?.currentLocationId ??
        locationId,
      state: actorInput.state ?? existing?.state,
      provenance: input.provenance,
      sessionId: input.sessionId,
      at: input.at,
    });
    const lifecycle = readCombatLifecycle(actor.state);
    // A new projection inherits the actor's canonical lifecycle. Any old
    // projection schedule is invalidated in this same transaction.
    db.prepare(
      `UPDATE encounter_combatant SET stable_recovery_roll=NULL,
       stable_recovery_anchor_elapsed_minutes=NULL,
       stable_recovery_deadline_elapsed_minutes=NULL
       WHERE campaign_id=? AND identity_kind='campaign_actor' AND identity_ref=?`,
    ).run(input.campaignId, actor.actorId);
    insertCombatant(db, {
      campaignId: input.campaignId,
      combatInstanceId,
      sourceEncounterId: input.encounterId,
      combatantId: `${combatInstanceId}-${slug(actor.actorId)}`,
      identityKind: 'campaign_actor',
      identityRef: actor.actorId,
      displayLabel: actor.displayName,
      rulesRef,
      side: actorInput.side ?? 'enemy',
      faction: actorInput.faction,
      hpCurrent: actor.hpCurrent ?? hpMax,
      hpMax: actor.hpMax ?? hpMax,
      ac: readCreatureAc(record),
      conditions: actor.conditions,
      status:
        actorInput.status === undefined &&
        (actor.status === 'escaped' ||
          actor.status === 'inactive' ||
          actor.status === 'unknown')
          ? 'alive'
          : actor.status === 'unknown'
            ? 'alive'
            : actor.status,
      headCount: lifecycle
        ? (lifecycle.headCount ?? undefined)
        : initialHeadCount(record),
      locationId: actor.currentLocationId ?? locationId,
      placement: actorInput.placement,
      provenance: input.provenance,
      sessionId: input.sessionId,
      at: input.at,
    });
    const projectedId = `${combatInstanceId}-${slug(actor.actorId)}`;
    db.prepare(
      `UPDATE encounter_combatant SET death_rules=?, death_save_successes=?,
       death_save_failures=?, recovery_block=?, stable_recovery_roll=?,
       stable_recovery_anchor_elapsed_minutes=?, stable_recovery_deadline_elapsed_minutes=?
       WHERE campaign_id=? AND combatant_id=?`,
    ).run(
      lifecycle?.deathRules ?? 'monster',
      lifecycle?.deathSaveSuccesses ?? 0,
      lifecycle?.deathSaveFailures ?? 0,
      lifecycle?.recoveryBlock ?? null,
      lifecycle?.stableRecovery?.roll ?? null,
      lifecycle?.stableRecovery?.anchor ?? null,
      lifecycle?.stableRecovery?.deadline ?? null,
      input.campaignId,
      projectedId,
    );
  }

  const combatInstance = activeInstance(db, input.campaignId);
  if (combatInstance === undefined) {
    throw new EncounterCombatantError('combat instance failed to start');
  }
  return {
    started: true,
    combatInstance,
    combatants: listCombatantsForInstance(
      db,
      input.campaignId,
      combatInstance.combatInstanceId,
    ),
  };
}

export function closeCombatInstance(
  db: Db,
  input: CloseCombatInstanceInput,
): CombatInstance {
  // One transaction covers the F3 closure boundary and the status flip: a
  // closed instance can never be committed while live effect state still
  // points at its combatants (F3 mutation audit §7). The effect reactions
  // run FIRST, while the combatants are still mutable.
  return withTransaction(db, (txnDb) => closeCombatInstanceInTxn(txnDb, input));
}

function closeCombatInstanceInTxn(
  db: Db,
  input: CloseCombatInstanceInput,
): CombatInstance {
  const instance =
    input.combatInstanceId === undefined
      ? activeInstance(db, input.campaignId)
      : readCombatInstance(db, input.campaignId, input.combatInstanceId);
  if (instance === undefined) {
    throw new EncounterCombatantError('no matching active combat instance');
  }
  if (instance.status !== 'active') {
    throw new EncounterCombatantError(
      `combat instance '${instance.combatInstanceId}' is ${instance.status} and cannot be reactivated or closed again`,
    );
  }
  applyCombatClosureToEffects(db, input.campaignId, instance.combatInstanceId, {
    provenance: input.provenance,
    sessionId: input.sessionId,
    at: input.at,
  });
  db.prepare(
    `UPDATE combat_instance
     SET status = ?, provenance = ?, session_id = ?, updated_at = ?, closed_at = ?
     WHERE campaign_id = ? AND combat_instance_id = ? AND status = 'active'`,
  ).run(
    input.status,
    input.provenance,
    input.sessionId,
    input.at,
    input.at,
    input.campaignId,
    instance.combatInstanceId,
  );
  const closed = readCombatInstance(
    db,
    input.campaignId,
    instance.combatInstanceId,
  );
  if (closed === undefined) {
    throw new EncounterCombatantError(
      'combat instance disappeared during close',
    );
  }
  return closed;
}

/**
 * The campaign's currently active combat instance, or `undefined` when no
 * combat is active. A read-only wrapper over the private active-instance lookup,
 * exposed so callers outside the encounter engine (e.g. the resume
 * conflict-resolution UX, eshyra-lupf.14.4) can warn before mutating a character
 * mid-combat.
 */
export function getActiveCombatInstance(
  db: Db,
  campaignId: string,
): CombatInstance | undefined {
  return activeInstance(db, campaignId);
}

export function readCombatInstance(
  db: Db,
  campaignId: string,
  combatInstanceId: string,
): CombatInstance | undefined {
  const row = db
    .prepare(
      `SELECT campaign_id, combat_instance_id, source_encounter_id,
              source_run_id, status, location_id, session_id, opened_at,
              updated_at, closed_at
       FROM combat_instance
       WHERE campaign_id = ? AND combat_instance_id = ?`,
    )
    .get(campaignId, combatInstanceId) as CombatInstanceRow | undefined;
  return row === undefined ? undefined : rowToCombatInstance(row);
}

function validCombatantIdsMessage(db: Db, campaignId: string): string {
  const ids = listCombatants(db, campaignId).map((c) => c.combatantId);
  return ids.length > 0
    ? `Valid active combatant ids: ${ids.join(', ')}.`
    : 'No active combatants are currently instantiated.';
}

export function readCombatant(
  db: Db,
  campaignId: string,
  combatantId: string,
): EncounterCombatant | undefined {
  const row = db
    .prepare(
      `SELECT campaign_id, combat_instance_id, source_encounter_id,
              combatant_id, identity_kind, identity_ref, display_label,
              rules_ref, side, faction, hp_current, hp_max, ac,
              conditions_json, status, location_id, placement, death_rules,
              death_save_successes, death_save_failures, recovery_block,
              stable_recovery_roll, stable_recovery_anchor_elapsed_minutes,
              stable_recovery_deadline_elapsed_minutes, head_count
       FROM encounter_combatant
       WHERE campaign_id = ? AND combatant_id = ?`,
    )
    .get(campaignId, combatantId) as CombatantRow | undefined;
  return row === undefined ? undefined : rowToCombatant(row);
}

export function updateCombatant(
  db: Db,
  input: UpdateCombatantInput,
): UpdateCombatantResult {
  // One transaction covers the combatant write, the actor sync, AND the F3
  // concentration reaction below: a combatant can never be committed as
  // down/dead while its concentration cleanup is lost or partial.
  return withTransaction(db, (txnDb) => updateCombatantInTxn(txnDb, input));
}

export function resolveCombatantDeathSave(
  db: Db,
  campaignId: string,
  combatantId: string,
  roll: number,
  ctx: { provenance: string; sessionId: string; at: string },
  rng: Rng = createSeededRng(0),
) {
  if (!Number.isInteger(roll) || roll < 1 || roll > 20)
    throw new EncounterCombatantError(
      'death save roll must be an integer between 1 and 20',
    );
  return withTransaction(db, (txn) => {
    const c = readCombatant(txn, campaignId, combatantId);
    requireActiveCombatant(txn, campaignId, c);
    if (c?.deathRules !== 'player-character' || c.status !== 'dying')
      throw new EncounterCombatantError(
        'only a dying player-character combatant may make death saves',
      );
    const transition = resolveDeathSaveTransition({
      roll,
      successes: c.deathSaveSuccesses,
      failures: c.deathSaveFailures,
      hp: c.hpCurrent,
      hpMax: effectiveHpMax(c.hpMax, c.conditions),
      recoveryBlocked: c.recoveryBlock !== null,
    });
    const { hpCurrent, successes, failures, outcome } = transition;
    const status = transition.lifeState as CombatantStatus;
    txn
      .prepare(
        'UPDATE encounter_combatant SET hp_current=?,status=?,death_save_successes=?,death_save_failures=?,recovery_block=?,provenance=?,session_id=?,updated_at=? WHERE campaign_id=? AND combatant_id=?',
      )
      .run(
        hpCurrent,
        status,
        successes,
        failures,
        status === 'dead' ? null : c.recoveryBlock,
        ctx.provenance,
        ctx.sessionId,
        ctx.at,
        campaignId,
        combatantId,
      );
    if (status === 'stable')
      scheduleCombatantRecovery(txn, campaignId, combatantId, rng);
    syncCombatantActor(txn, campaignId, combatantId, ctx);
    return {
      roll,
      outcome,
      deathSaveSuccesses: successes,
      deathSaveFailures: failures,
      lifeState: status,
      hpCurrent,
      ...(c.recoveryBlock ? { recoveryBlocked: c.recoveryBlock } : {}),
    };
  });
}

export function stabilizeCombatant(
  db: Db,
  campaignId: string,
  combatantId: string,
  ctx: { provenance: string; sessionId: string; at: string },
  rng: Rng = createSeededRng(0),
) {
  return withTransaction(db, (txn) => {
    const c = readCombatant(txn, campaignId, combatantId);
    requireActiveCombatant(txn, campaignId, c);
    if (c?.deathRules !== 'player-character' || c.status !== 'dying')
      throw new EncounterCombatantError(
        'only a dying player-character combatant can be stabilized',
      );
    if (c.recoveryBlock)
      throw new EncounterCombatantError(
        `cannot stabilize while ${c.recoveryBlock}`,
      );
    txn
      .prepare(
        "UPDATE encounter_combatant SET status='stable',death_save_successes=0,death_save_failures=0,provenance=?,session_id=?,updated_at=? WHERE campaign_id=? AND combatant_id=?",
      )
      .run(ctx.provenance, ctx.sessionId, ctx.at, campaignId, combatantId);
    scheduleCombatantRecovery(txn, campaignId, combatantId, rng);
    syncCombatantActor(txn, campaignId, combatantId, ctx);
    return { lifeState: 'stable' as const, hpCurrent: c.hpCurrent };
  });
}

export function setCombatantSuffocation(
  db: Db,
  campaignId: string,
  combatantId: string,
  event: 'drop' | 'breathe',
  ctx: { provenance: string; sessionId: string; at: string },
  rng: Rng = createSeededRng(0),
) {
  return withTransaction(db, (txn) => {
    const c = readCombatant(txn, campaignId, combatantId);
    if (!c) throw new EncounterCombatantError('unknown combatant');
    requireActiveCombatant(txn, campaignId, c);
    const wasDown =
      c.hpCurrent === 0 ||
      c.status === 'dead' ||
      c.status === 'unconscious' ||
      c.status === 'inactive' ||
      c.status === 'dying' ||
      c.status === 'stable';
    let status = c.status,
      hp = c.hpCurrent,
      block = c.recoveryBlock,
      successes = c.deathSaveSuccesses,
      failures = c.deathSaveFailures;
    if (event === 'drop') {
      if (status === 'dead')
        throw new EncounterCombatantError(
          'cannot begin suffocation for a dead combatant',
        );
      if (!block) {
        hp = 0;
        status = c.deathRules === 'player-character' ? 'dying' : 'dead';
        // A monster dies at 0 HP (rule:monsters-and-death), so only a dying
        // combatant carries the block.
        block = status === 'dying' ? 'suffocating' : null;
        if (status === 'dying' && c.status !== 'dying') {
          successes = 0;
          failures = 0;
          txn
            .prepare(
              'UPDATE encounter_combatant SET stable_recovery_roll=NULL, stable_recovery_anchor_elapsed_minutes=NULL, stable_recovery_deadline_elapsed_minutes=NULL WHERE campaign_id=? AND combatant_id=?',
            )
            .run(campaignId, combatantId);
        }
      }
    } else {
      if (!block)
        throw new EncounterCombatantError(
          'combatant has no recovery block to clear',
        );
      block = null;
      if (status === 'stable') {
        txn
          .prepare(
            'UPDATE encounter_combatant SET stable_recovery_roll=NULL, stable_recovery_anchor_elapsed_minutes=NULL, stable_recovery_deadline_elapsed_minutes=NULL WHERE campaign_id=? AND combatant_id=?',
          )
          .run(campaignId, combatantId);
      }
      if (status === 'dying' && successes >= 3) {
        status = 'stable';
        successes = 0;
        failures = 0;
        scheduleCombatantRecovery(txn, campaignId, combatantId, rng);
      }
    }
    txn
      .prepare(
        'UPDATE encounter_combatant SET hp_current=?,status=?,recovery_block=?,death_save_successes=?,death_save_failures=?,provenance=?,session_id=?,updated_at=? WHERE campaign_id=? AND combatant_id=?',
      )
      .run(
        hp,
        status,
        block,
        successes,
        failures,
        ctx.provenance,
        ctx.sessionId,
        ctx.at,
        campaignId,
        combatantId,
      );
    const isDown =
      hp === 0 ||
      status === 'dead' ||
      status === 'unconscious' ||
      status === 'inactive' ||
      status === 'dying' ||
      status === 'stable';
    if (!wasDown && isDown)
      breakCombatantConcentration(
        txn,
        campaignId,
        combatantId,
        status === 'dead' ? 'dead' : 'incapacitated',
        ctx,
      );
    syncCombatantActor(txn, campaignId, combatantId, ctx);
    return { lifeState: status, hpCurrent: hp };
  });
}

export function resolveCombatantRecoveries(
  db: Db,
  elapsed: number,
  ctx: { provenance: string; sessionId: string; at: string },
) {
  return withTransaction(db, (txn) => {
    const rows = txn
      .prepare(
        `SELECT c.campaign_id,c.combatant_id,c.combat_instance_id,c.identity_kind,c.identity_ref
         FROM encounter_combatant c JOIN combat_instance i USING(campaign_id,combat_instance_id)
         WHERE c.status='stable' AND c.hp_current=0 AND c.stable_recovery_deadline_elapsed_minutes<=?
         AND (c.identity_kind<>'campaign_actor' OR NOT EXISTS (
           SELECT 1 FROM encounter_combatant n JOIN combat_instance ni USING(campaign_id,combat_instance_id)
           WHERE n.campaign_id=c.campaign_id AND n.identity_kind='campaign_actor' AND n.identity_ref=c.identity_ref
             AND (ni.opened_at>i.opened_at OR (ni.opened_at=i.opened_at AND n.combatant_id>c.combatant_id))))
         ORDER BY c.stable_recovery_deadline_elapsed_minutes,c.combatant_id`,
      )
      .all(elapsed) as Array<{ campaign_id: string; combatant_id: string }>;
    for (const row of rows) {
      txn
        .prepare(
          "UPDATE encounter_combatant SET hp_current=1,status='alive',death_save_successes=0,death_save_failures=0,stable_recovery_roll=NULL,stable_recovery_anchor_elapsed_minutes=NULL,stable_recovery_deadline_elapsed_minutes=NULL,provenance=?,session_id=?,updated_at=? WHERE campaign_id=? AND combatant_id=?",
        )
        .run(
          ctx.provenance,
          ctx.sessionId,
          ctx.at,
          row.campaign_id,
          row.combatant_id,
        );
      syncCombatantActor(txn, row.campaign_id, row.combatant_id, ctx);
    }
    return rows.length;
  });
}

function scheduleCombatantRecovery(
  db: Db,
  campaignId: string,
  combatantId: string,
  rng: Rng,
) {
  const clock = db
    .prepare('SELECT elapsed_minutes FROM clock WHERE id=1')
    .get() as { elapsed_minutes: number };
  const roll = rollDice('1d4', rng).total;
  const anchor = clock.elapsed_minutes;
  db.prepare(
    'UPDATE encounter_combatant SET stable_recovery_roll=?,stable_recovery_anchor_elapsed_minutes=?,stable_recovery_deadline_elapsed_minutes=? WHERE campaign_id=? AND combatant_id=?',
  ).run(roll, anchor, anchor + roll * 60, campaignId, combatantId);
}
function syncCombatantActor(
  db: Db,
  campaignId: string,
  id: string,
  ctx: { provenance: string; sessionId: string; at: string },
) {
  const c = readCombatant(db, campaignId, id);
  if (c?.identityKind !== 'campaign_actor' || !c.identityRef) return;
  if (!isCurrentActorProjection(db, campaignId, c.identityRef, id)) return;
  const a = getCampaignActor(db, campaignId, c.identityRef);
  if (!a) return;
  const state = {
    ...a.state,
    combatLifecycle: {
      deathRules: c.deathRules,
      deathSaveSuccesses: c.deathSaveSuccesses,
      deathSaveFailures: c.deathSaveFailures,
      recoveryBlock: c.recoveryBlock,
      stableRecovery:
        c.stableRecoveryRoll === null
          ? null
          : {
              roll: c.stableRecoveryRoll,
              anchor: c.stableRecoveryAnchorElapsedMinutes,
              deadline: c.stableRecoveryDeadlineElapsedMinutes,
            },
      headCount: c.headCount,
    } as unknown as JsonValue,
  };
  upsertCampaignActor(db, {
    campaignId,
    actorId: c.identityRef,
    displayName: a.displayName,
    actorKind: a.actorKind,
    sourceKind: a.sourceKind,
    sourceRef: a.sourceRef,
    rulesRef: a.rulesRef,
    hpCurrent: c.hpCurrent,
    hpMax: c.hpMax,
    conditions: c.conditions,
    status: c.status,
    currentLocationId: c.locationId,
    state,
    provenance: ctx.provenance,
    sessionId: ctx.sessionId,
    at: ctx.at,
  });
}

function updateCombatantInTxn(
  db: Db,
  input: UpdateCombatantInput,
): UpdateCombatantResult {
  const current = readCombatant(db, input.campaignId, input.combatantId);
  if (current === undefined) {
    throw new EncounterCombatantError(
      `unknown combatant '${input.combatantId}'. ${validCombatantIdsMessage(
        db,
        input.campaignId,
      )}`,
    );
  }
  const instance = readCombatInstance(
    db,
    input.campaignId,
    current.combatInstanceId,
  );
  if (instance?.status !== 'active') {
    throw new EncounterCombatantError(
      `combatant '${input.combatantId}' belongs to inactive combat instance '${current.combatInstanceId}'`,
    );
  }
  const currentMechanic = multipleHeadsMechanic(
    lookupCampaignRecord(
      db,
      'creature',
      current.rulesRef,
      input.resolveRulesPack,
    ),
  );
  if (
    currentMechanic &&
    current.headCount === null &&
    (input.hpDelta !== undefined || input.status !== undefined)
  )
    throw new EncounterCombatantError(
      "this combatant's head count is unknown because its encounter began before head tracking; close the combat instance and start it again",
    );
  if (input.hpDelta !== undefined && !Number.isInteger(input.hpDelta)) {
    throw new EncounterCombatantError(
      'hpDelta must be an integer when provided',
    );
  }
  const previousHp = current.hpCurrent;
  const conditions = input.replaceConditions
    ? [...input.replaceConditions]
    : [...current.conditions];
  const hpMax = effectiveHpMax(current.hpMax, conditions);
  const nextHp =
    input.hpDelta === undefined
      ? current.hpCurrent
      : Math.max(0, Math.min(hpMax, current.hpCurrent + input.hpDelta));
  let conditionAdded = false;
  let conditionRemoved = false;
  if (input.addCondition !== undefined) {
    if (
      typeof input.addCondition.id !== 'string' ||
      input.addCondition.id.length === 0
    ) {
      throw new EncounterCombatantError('addCondition.id must be non-empty');
    }
    if (
      input.addCondition.id === 'exhaustion' ||
      input.addCondition.id === 'exhausted'
    )
      throw new EncounterCombatantError(
        'exhaustion levels must be changed with adjust_exhaustion',
      );
    if (!conditions.some((c) => c.id === input.addCondition?.id)) {
      conditions.push(input.addCondition);
      conditionAdded = true;
    }
  }
  if (input.removeCondition !== undefined) {
    const before = conditions.length;
    const remaining = conditions.filter((c) => c.id !== input.removeCondition);
    conditionRemoved = remaining.length !== before;
    conditions.splice(0, conditions.length, ...remaining);
  }
  const deathRules = input.deathRules ? 'player-character' : current.deathRules;
  let status = input.status ?? current.status;
  let headCount = current.headCount;
  let headsDiedSinceOwnTurn = 0;
  let fireDamageSinceOwnTurn = 0;
  let damageThisTurn = 0;
  let damageTurnKey: string | null = null;
  let headDiedThisTurn = 0;
  const mechanic = currentMechanic;
  if (headCount !== null) {
    const tracked = db
      .prepare(
        `SELECT heads_died_since_own_turn, fire_damage_since_own_turn,
              damage_this_turn, damage_turn_key, head_died_this_turn
       FROM encounter_combatant WHERE campaign_id = ? AND combatant_id = ?`,
      )
      .get(input.campaignId, input.combatantId) as {
      heads_died_since_own_turn: number;
      fire_damage_since_own_turn: number;
      damage_this_turn: number;
      damage_turn_key: string | null;
      head_died_this_turn: number;
    };
    headsDiedSinceOwnTurn = tracked.heads_died_since_own_turn;
    fireDamageSinceOwnTurn = tracked.fire_damage_since_own_turn;
    damageThisTurn = tracked.damage_this_turn;
    damageTurnKey = tracked.damage_turn_key;
    headDiedThisTurn = tracked.head_died_this_turn;
    if (input.hpDelta !== undefined && input.hpDelta < 0) {
      const turn = db
        .prepare(
          `SELECT round_number, active_participant_kind, active_participant_ref
         FROM combat_instance WHERE campaign_id = ? AND combat_instance_id = ?`,
        )
        .get(input.campaignId, current.combatInstanceId) as {
        round_number: number;
        active_participant_kind: string | null;
        active_participant_ref: string | null;
      };
      const key = `${current.combatInstanceId}:${turn.round_number}:${turn.active_participant_kind ?? 'none'}:${turn.active_participant_ref ?? 'none'}`;
      if (damageTurnKey !== key) {
        damageThisTurn = 0;
        headDiedThisTurn = 0;
        damageTurnKey = key;
      }
      damageThisTurn += -input.hpDelta;
      if (input.damageTypes?.includes('fire')) fireDamageSinceOwnTurn = 1;
      const mechanic = multipleHeadsMechanic(
        lookupCampaignRecord(
          db,
          'creature',
          current.rulesRef,
          input.resolveRulesPack,
        ),
      );
      if (
        mechanic !== undefined &&
        headDiedThisTurn === 0 &&
        damageThisTurn >= mechanic.headDiesWhenDamageInOneTurnAtLeast
      ) {
        headCount = Math.max(0, headCount - 1);
        headsDiedSinceOwnTurn += 1;
        headDiedThisTurn = 1;
      }
      if (headCount === 0 && mechanic?.deathWhenNoHeads) status = 'dead';
    }
  }
  let successes = current.deathSaveSuccesses;
  let failures = current.deathSaveFailures;
  let recoveryBlock = current.recoveryBlock;
  let recoveryRoll = current.stableRecoveryRoll;
  let recoveryAnchor = current.stableRecoveryAnchorElapsedMinutes;
  let recoveryDeadline = current.stableRecoveryDeadlineElapsedMinutes;
  let armRecovery = false;
  // 'dying' and 'stable' exist only under the player-character death rules,
  // and the engine owns their transitions (rule:monsters-and-death opts a
  // creature in; the character death rules then apply).
  if (
    (input.status === 'dying' || input.status === 'stable') &&
    deathRules !== 'player-character'
  )
    throw new EncounterCombatantError(
      `status '${input.status}' requires deathRules 'player-character'`,
    );
  const droppedToZero =
    input.hpDelta !== undefined && current.hpCurrent > 0 && nextHp === 0;
  const exhaustionSix = conditions.some(
    (c) => c.id === 'exhaustion' && c.level === 6,
  );
  const noHeadsDeath = headCount === 0 && mechanic?.deathWhenNoHeads === true;
  if ((deathRules === 'player-character' && exhaustionSix) || noHeadsDeath) {
    if (
      input.status !== undefined &&
      input.status !== 'dead' &&
      input.status !== 'inactive'
    )
      throw new EncounterCombatantError(
        'this combatant is dead from an irreversible lifecycle condition',
      );
    if (input.hpDelta !== undefined && input.hpDelta > 0)
      throw new EncounterCombatantError(
        'healing cannot revive a combatant dead from an irreversible lifecycle condition',
      );
    status = input.status === 'inactive' ? 'inactive' : 'dead';
  }
  if (deathRules === 'player-character') {
    if (input.status === 'dying')
      throw new EncounterCombatantError(
        'a player-character combatant becomes dying through hpDelta, never an explicit status',
      );
    if (
      (input.status === 'alive' || input.status === 'unconscious') &&
      nextHp === 0
    )
      throw new EncounterCombatantError(
        `status '${input.status}' needs hit points above 0 under player-character death rules`,
      );
    if (input.status === 'stable' && !droppedToZero)
      throw new EncounterCombatantError(
        "status 'stable' is accepted only as a knockout: with an hpDelta that reduces the combatant from above 0 to 0 hit points",
      );
    if (input.status === 'stable' && recoveryBlock !== null)
      throw new EncounterCombatantError(
        `cannot stabilize while ${recoveryBlock}`,
      );
    if (
      current.status === 'dead' &&
      input.status !== undefined &&
      input.status !== 'dead' &&
      input.status !== 'inactive'
    )
      throw new EncounterCombatantError(
        'a dead player-character combatant cannot change to a living or escaped status',
      );
    if (
      input.hpDelta !== undefined &&
      input.hpDelta > 0 &&
      current.status === 'dead'
    )
      throw new EncounterCombatantError(
        'healing a dead player-character combatant is refused',
      );
    if (input.hpDelta !== undefined && input.hpDelta > 0 && recoveryBlock)
      throw new EncounterCombatantError(
        `cannot regain hit points while ${recoveryBlock}`,
      );
    if (input.status !== undefined) {
      // Explicit statuses validated above: dead/escaped/inactive at any HP,
      // alive/unconscious above 0, stable only as a knockout.
      status = input.status;
      if (status === 'stable') {
        successes = 0;
        failures = 0;
        armRecovery = true;
      }
    } else if (input.hpDelta !== undefined) {
      if (droppedToZero) {
        const overflow = Math.max(0, -input.hpDelta - current.hpCurrent);
        status = overflow >= hpMax ? 'dead' : 'dying';
        successes = 0;
        failures = 0;
      } else if (
        current.hpCurrent === 0 &&
        input.hpDelta < 0 &&
        (current.status === 'dying' || current.status === 'stable')
      ) {
        if (-input.hpDelta >= hpMax) status = 'dead';
        else {
          failures = Math.min(3, failures + (input.critical ? 2 : 1));
          status = failures >= 3 ? 'dead' : 'dying';
        }
      } else if (input.hpDelta > 0 && current.hpCurrent === 0) {
        status = 'alive';
        successes = 0;
        failures = 0;
      }
    }
  } else if (input.hpDelta !== undefined) {
    status =
      input.status ??
      (nextHp === 0
        ? 'dead'
        : current.status === 'dead'
          ? 'alive'
          : current.status);
  }
  if (headCount === 0 && current.headCount !== 0 && input.status !== 'inactive')
    status = 'dead';
  if (status !== 'stable' || armRecovery) {
    recoveryRoll = null;
    recoveryAnchor = null;
    recoveryDeadline = null;
  }
  // A dead creature carries no recovery block (mirrors characters).
  if (status === 'dead') recoveryBlock = null;
  const locationId = input.locationId ?? current.locationId;
  const placement = input.placement ?? current.placement;

  db.prepare(
    `UPDATE encounter_combatant
     SET hp_current = ?, conditions_json = ?, status = ?, location_id = ?,
         head_count = ?, heads_died_since_own_turn = ?,
         fire_damage_since_own_turn = ?, damage_this_turn = ?,
         damage_turn_key = ?, head_died_this_turn = ?,
         death_rules = ?, death_save_successes = ?, death_save_failures = ?,
         recovery_block = ?, stable_recovery_roll = ?,
         stable_recovery_anchor_elapsed_minutes = ?, stable_recovery_deadline_elapsed_minutes = ?,
         placement = ?, provenance = ?, session_id = ?, updated_at = ?
     WHERE campaign_id = ? AND combatant_id = ?`,
  ).run(
    nextHp,
    JSON.stringify(conditions),
    status,
    locationId ?? null,
    headCount,
    headsDiedSinceOwnTurn,
    fireDamageSinceOwnTurn,
    damageThisTurn,
    damageTurnKey,
    headDiedThisTurn,
    deathRules,
    successes,
    failures,
    recoveryBlock,
    recoveryRoll,
    recoveryAnchor,
    recoveryDeadline,
    placement ?? null,
    input.provenance,
    input.sessionId,
    input.at,
    input.campaignId,
    input.combatantId,
  );
  if (
    headCount !== current.headCount &&
    headCount !== null &&
    hasOnePerHeadReaction(
      lookupCampaignRecord(
        db,
        'creature',
        current.rulesRef,
        input.resolveRulesPack,
      ),
    )
  ) {
    db.prepare(
      `UPDATE combat_turn_budget SET reaction_allowance = ?,
         provenance = ?, session_id = ?, updated_at = ?
       WHERE campaign_id = ? AND combat_instance_id = ?
         AND participant_kind = 'combatant' AND participant_ref = ?`,
    ).run(
      Math.max(1, headCount),
      input.provenance,
      input.sessionId,
      input.at,
      input.campaignId,
      current.combatInstanceId,
      current.combatantId,
    );
  }
  // A knockout ("falls unconscious and is stable") arms the same 1d4-hour
  // recovery deadline a stabilized combatant gets.
  if (armRecovery)
    scheduleCombatantRecovery(
      db,
      input.campaignId,
      input.combatantId,
      input.rng ?? createSeededRng(0),
    );

  let syncedActor: CampaignActor | undefined;
  if (
    current.identityKind === 'campaign_actor' &&
    current.identityRef !== undefined
  ) {
    syncCombatantActor(db, input.campaignId, input.combatantId, input);
    syncedActor = getCampaignActor(db, input.campaignId, current.identityRef);
  }

  // F3 reaction (same-transaction, mirroring hpLifecycle's character hook):
  // a combatant that goes down — 0 HP, an explicit dead/unconscious status,
  // or a newly applied condition whose structured record implies
  // `incapacitated` (paralyzed, stunned, …) — is incapacitated, which breaks
  // its concentration and cleans up the effect's owned projections
  // atomically with this write. Transition-gated on both sides so an
  // already-incapacitated combatant (by any route) triggers nothing further.
  const wasDown =
    current.hpCurrent === 0 ||
    current.status === 'dead' ||
    current.status === 'unconscious' ||
    current.status === 'dying' ||
    current.status === 'stable' ||
    current.status === 'inactive';
  const isDown =
    nextHp === 0 ||
    status === 'dead' ||
    status === 'unconscious' ||
    status === 'dying' ||
    status === 'stable' ||
    status === 'inactive';
  const wasIncapacitated =
    wasDown ||
    anyConditionImpliesIncapacitated(
      db,
      current.conditions.map((c) => c.id),
    );
  const isIncapacitated =
    isDown ||
    anyConditionImpliesIncapacitated(
      db,
      conditions.map((c) => c.id),
    );
  let concentrationBroken: UpdateCombatantResult['concentrationBroken'];
  if (!wasIncapacitated && isIncapacitated) {
    const broken = breakCombatantConcentration(
      db,
      input.campaignId,
      input.combatantId,
      status === 'dead'
        ? 'dead'
        : status === 'inactive'
          ? 'owner-removed'
          : 'incapacitated',
      {
        provenance: input.provenance,
        sessionId: input.sessionId,
        at: input.at,
      },
    );
    if (broken.broken && broken.effectId !== undefined) {
      concentrationBroken = {
        effectId: broken.effectId,
        displayName: broken.displayName ?? broken.effectId,
        cause:
          status === 'dead'
            ? 'dead'
            : status === 'inactive'
              ? 'owner-removed'
              : 'incapacitated',
      };
    }
  }

  const combatant = readCombatant(db, input.campaignId, input.combatantId);
  if (combatant === undefined) {
    throw new EncounterCombatantError('combatant disappeared during update');
  }
  return {
    combatant,
    syncedActor,
    previousHp,
    hpDelta: input.hpDelta,
    conditionAdded,
    conditionRemoved,
    ...(concentrationBroken === undefined ? {} : { concentrationBroken }),
  };
}
