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
  closeActorLinkAtZeroHp,
  findActiveNaturalForm,
  findRemovePolicyActorLink,
  type NaturalForm,
} from './activeEffects.js';
import {
  type CampaignRulesPackResolver,
  lookupCampaignRecord,
} from './campaignRecordLookup.js';
import {
  type CombatantHeadMechanic,
  type CombatantLifecycleEvent,
  type CombatantLifecycleState,
  describeZeroHpRule,
  leavesPlayAtZeroHp,
  nextCombatantLifecycle,
  revertsFormAtZeroHp,
  type StableRecoverySchedule,
  type ZeroHpRule,
} from './combatantLifecycle.js';
import { effectiveHpMax, exhaustionLevel } from './exhaustion.js';
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
  | 'stable'
  | 'absent';
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
  | 'stable'
  | 'absent';

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
  /** The creature's own 0-hit-point rule, set by its owning effect. */
  readonly zeroHpRule: ZeroHpRule | null;
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
  /** Internal lifecycle synchronization; callers must not expose this. */
  readonly replaceCombatLifecycle?: boolean;
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
  readonly resolveRulesPack?: CampaignRulesPackResolver;
}

export interface UpdateCombatantInput {
  readonly campaignId: string;
  readonly combatantId: string;
  /** Internal actor projection update; model-facing tools cannot supply this. */
  readonly hpMax?: number;
  readonly hpDelta?: number;
  readonly clampToEffectiveMaximum?: boolean;
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
  readonly resolveRulesPack?: CampaignRulesPackResolver;
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
  if (
    input.addCondition?.id === 'exhaustion' ||
    input.addCondition?.id === 'exhausted' ||
    input.removeCondition === 'exhaustion' ||
    input.removeCondition === 'exhausted'
  )
    throw new EncounterCombatantError(
      'exhaustion levels must be changed with adjust_exhaustion',
    );
  return withTransaction(db, (txnDb) => {
    const actor = getCampaignActor(txnDb, input.campaignId, input.actorId);
    if (actor === undefined) {
      throw new EncounterCombatantError(
        `unknown campaign actor '${input.actorId}'`,
      );
    }
    if (input.status === 'absent')
      throw new EncounterCombatantError(
        "status 'absent' is engine-owned: a creature leaves play through its owning effect or its zero-hit-point rule",
      );
    if (
      actor.status === 'absent' &&
      (input.status !== undefined ||
        input.hpCurrent !== undefined ||
        input.hpMax !== undefined ||
        input.addCondition !== undefined ||
        input.removeCondition !== undefined)
    )
      throw new EncounterCombatantError(
        `campaign actor '${input.actorId}' is absent (out of play); only a new admission with hit points above 0 brings it back`,
      );
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
    const projection = txnDb
      .prepare(
        `SELECT combatant_id, hp_current, hp_max FROM encounter_combatant
         WHERE campaign_id = ? AND identity_kind = 'campaign_actor' AND identity_ref = ?
           AND combat_instance_id IN (SELECT combat_instance_id FROM combat_instance WHERE campaign_id = ? AND status = 'active')
         ORDER BY combatant_id LIMIT 1`,
      )
      .get(input.campaignId, input.actorId, input.campaignId) as
      | { combatant_id: string; hp_current: number; hp_max: number }
      | undefined;
    // Out of combat, a creature that leaves play at 0 hit points does so when
    // its hit points are reduced to 0 (in combat the lifecycle does the
    // same); one that reverts to its natural form is restored instead.
    const droppedOutOfCombat =
      projection === undefined &&
      input.hpCurrent === 0 &&
      (actor.hpCurrent ?? 0) > 0;
    const vanishesOutOfCombat =
      droppedOutOfCombat &&
      leavesPlayAtZeroHp(readCombatLifecycle(actor.state)?.zeroHpRule ?? null);
    if (
      droppedOutOfCombat &&
      revertsFormAtZeroHp(readCombatLifecycle(actor.state)?.zeroHpRule ?? null)
    ) {
      const found = findActiveNaturalForm(txnDb, input.campaignId, {
        actorId: input.actorId,
      });
      if (found?.naturalForm === undefined)
        throw new EncounterCombatantError(noNaturalFormMessage(input.actorId));
      const form = found.naturalForm;
      const hp = Math.min(
        form.hpCurrent,
        effectiveHpMax(form.hpMax, conditions),
      );
      upsertCampaignActor(txnDb, {
        campaignId: input.campaignId,
        actorId: input.actorId,
        displayName: actor.displayName,
        actorKind: actor.actorKind,
        sourceKind: actor.sourceKind,
        sourceRef: actor.sourceRef,
        rulesRef: form.rulesRef,
        hpCurrent: hp,
        hpMax: form.hpMax,
        conditions,
        status: hp === 0 ? 'dead' : 'alive',
        currentLocationId: input.currentLocationId ?? actor.currentLocationId,
        state: revertedActorState(actor.state),
        replaceCombatLifecycle: true,
        provenance: input.provenance,
        sessionId: input.sessionId,
        at: input.at,
      });
      closeActorLinkAtZeroHp(
        txnDb,
        input.campaignId,
        { actorId: input.actorId },
        input,
        'close',
        'reverted-form',
      );
      const reverted = getCampaignActor(txnDb, input.campaignId, input.actorId);
      if (reverted === undefined)
        throw new EncounterCombatantError('campaign actor update failed');
      return reverted;
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
      status: vanishesOutOfCombat ? 'absent' : (input.status ?? actor.status),
      currentLocationId: input.currentLocationId ?? actor.currentLocationId,
      state: vanishesOutOfCombat ? absentActorState(actor.state) : actor.state,
      ...(vanishesOutOfCombat ? { replaceCombatLifecycle: true } : {}),
      provenance: input.provenance,
      sessionId: input.sessionId,
      at: input.at,
    });
    if (vanishesOutOfCombat)
      closeActorLinkAtZeroHp(
        txnDb,
        input.campaignId,
        { actorId: input.actorId },
        input,
        readCombatLifecycle(actor.state)?.zeroHpRule === 'vanish-bonded'
          ? 'keep'
          : 'close',
      );
    if (projection !== undefined) {
      updateCombatant(txnDb, {
        campaignId: input.campaignId,
        combatantId: projection.combatant_id,
        ...(input.hpMax === undefined ? {} : { hpMax: input.hpMax }),
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
        ...(input.resolveRulesPack === undefined
          ? {}
          : { resolveRulesPack: input.resolveRulesPack }),
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
  // Own the write boundary: a refused promotion restores the prior actor row.
  return withTransaction(db, (txnDb) =>
    ensureCampaignActorFromCombatantInTxn(txnDb, input),
  );
}

function ensureCampaignActorFromCombatantInTxn(
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
  const ownerId = currentActorProjectionId(db, input.campaignId, input.actorId);
  const combatant = readCombatant(
    db,
    input.campaignId,
    ownerId ?? input.combatantId,
  );
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
  const lifecycle = combatLifecycleForCombatant(
    db,
    input.campaignId,
    combatant.combatantId,
  );
  const promoted = upsertCampaignActor(db, {
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
    state: {
      ...(existing?.state ?? {}),
      combatLifecycle: lifecycle as unknown as JsonValue,
    },
    replaceCombatLifecycle: true,
    provenance: input.provenance,
    sessionId: input.sessionId,
    at: input.at,
  });
  // Promotion makes this row the actor's current projection owner. Its
  // schedule remains on the row and in the durable actor snapshot; repeated
  // promotion therefore cannot replace a pending owner with an empty one.
  db.prepare(`UPDATE encounter_combatant
    SET identity_kind='campaign_actor', identity_ref=?,
        provenance=?, session_id=?, updated_at=?
    WHERE campaign_id=? AND combatant_id=?`).run(
    input.actorId,
    input.provenance,
    input.sessionId,
    input.at,
    input.campaignId,
    combatant.combatantId,
  );
  assertCombatantLifecycle(
    db,
    input.campaignId,
    combatant.combatantId,
    combatant,
  );
  assertCampaignActorLifecycle(promoted);
  return promoted;
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
  /** Set when this update brought a creature that disappears at 0 HP to 0:
   *  it is now absent. Under 'vanish' its summoning link was closed and its
   *  effect ended when that was the last owned creature; under
   *  'vanish-bonded' (familiar, steed) the link and effect stay active. */
  readonly vanished?: VanishedOutcome;
  /** Set when this update brought a creature that reverts at 0 HP to 0:
   *  an animated object left play as a creature ('revert-object', absent);
   *  a transformed creature is back in its natural form and still in play
   *  ('revert-form'). */
  readonly reverted?: RevertedOutcome;
}

/** A creature's reversion at 0 hit points. The link to its owning effect
 *  closed (reason zero-hit-points) and the effect ended when that was the
 *  last owned creature. */
export type RevertedOutcome = {
  readonly effectId: string | null;
  readonly effectEnded: boolean;
} & (
  | {
      readonly rule: 'revert-object';
      /** Damage beyond the hit points the creature had, which carries over to
       *  its original object form (objects are not tracked: the amount is
       *  reported, never stored). 0 when the drop was not damage. */
      readonly carriedOverDamage: number;
    }
  | {
      readonly rule: 'revert-form';
      /** The natural form restored: exactly the values recorded at cast
       *  (hit points clamped to the effective maximum). */
      readonly naturalForm: NaturalForm;
    }
);

function noNaturalFormMessage(subject: string): string {
  return (
    `'${subject}' reverts to its natural form at 0 hit points, but no active effect link records its natural form ` +
    '(it was transformed before natural forms were recorded); that reversion cannot be resolved. ' +
    'Ending or removing its owning effect target still works'
  );
}

/** Actor state after reverting to a natural form: the 0-hit-point rule and
 *  life-state bookkeeping of the transformation do not survive. */
function revertedActorState(
  state: Record<string, JsonValue>,
): Record<string, JsonValue> {
  const lifecycle = state.combatLifecycle;
  if (
    typeof lifecycle !== 'object' ||
    lifecycle === null ||
    Array.isArray(lifecycle)
  )
    return state;
  return {
    ...state,
    combatLifecycle: {
      ...lifecycle,
      deathSaveSuccesses: 0,
      deathSaveFailures: 0,
      recoveryBlock: null,
      stableRecovery: null,
      stableRecoverySettled: false,
      zeroHpRule: null,
    },
  };
}

export interface VanishedOutcome {
  readonly rule: 'vanish' | 'vanish-bonded';
  readonly effectId: string | null;
  readonly effectEnded: boolean;
  /** True when the creature's bond survives its absence ('vanish-bonded'). */
  readonly linkKept: boolean;
}

export interface CombatantHeadRegrowthResult {
  readonly combatantId: string;
  readonly headsRegrown: number;
  readonly hitPointsRegained: number;
  readonly headCount: number;
}

const UNKNOWN_HEAD_STATE_MESSAGE =
  "this creature's head count is unknown because its state predates head tracking; Eshyra cannot reconstruct it, so head-dependent damage, healing, turn settlement, and extra reactions are refused";

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
  // An absent creature is out of play: it has no turn-end head settlement
  // (S49); removal to absent already cleared its pending head counters.
  if (combatant === undefined || combatant.status === 'absent')
    return undefined;
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
    throw new EncounterCombatantError(UNKNOWN_HEAD_STATE_MESSAGE);
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
  const lifecycle = transitionCombatantLifecycle(
    readCombatantLifecycleState(db, combatant),
    {
      type: 'headsRegrown',
      count: headsRegrown,
      hpPerHead: mechanic.hitPointsPerRegrownHead,
      allowHealing: combatant.recoveryBlock === null,
    },
  );
  persistCombatantLifecycle(db, combatant, lifecycle, input);
  const headCount = lifecycle.headCount as number;
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
  const hitPointsRegained = lifecycle.hpCurrent - combatant.hpCurrent;
  // Settlement changes durable pending facts even when blocked or there was
  // no healing. Persist that exact lifecycle in the same turn transaction.
  syncCombatantActor(db, input.campaignId, input.combatantId, input);
  assertCombatantLifecycle(db, input.campaignId, input.combatantId, combatant);
  return headsRegrown === 0
    ? undefined
    : {
        combatantId: input.combatantId,
        headsRegrown,
        hitPointsRegained,
        headCount,
      };
}

/** Reset the per-turn Multiple Heads accumulator through the lifecycle seam. */
export function resetCombatantDamageForTurn(
  db: Db,
  input: {
    readonly campaignId: string;
    readonly combatInstanceId: string;
    readonly turnKey: string;
    readonly provenance: string;
    readonly sessionId: string;
    readonly at: string;
  },
): void {
  const rows = db
    .prepare(`SELECT combatant_id FROM encounter_combatant
      WHERE campaign_id=? AND combat_instance_id=?
        AND (damage_turn_key IS NULL OR damage_turn_key<>?)
      ORDER BY combatant_id`)
    .all(input.campaignId, input.combatInstanceId, input.turnKey) as Array<{
    combatant_id: string;
  }>;
  for (const row of rows) {
    const combatant = readCombatant(db, input.campaignId, row.combatant_id);
    if (!combatant) continue;
    const lifecycle = transitionCombatantLifecycle(
      readCombatantLifecycleState(db, combatant),
      { type: 'beginTurn', turnKey: input.turnKey },
    );
    persistCombatantLifecycle(db, combatant, lifecycle, input);
    assertCombatantLifecycle(
      db,
      input.campaignId,
      combatant.combatantId,
      combatant,
    );
    // A reset that repairs HP/life state of a current actor projection keeps
    // the canonical actor in the same transaction. Accumulator-only resets
    // and historical rows (syncCombatantActor ignores them) never sync.
    if (lifecycleRepairedByReset(combatant, lifecycle))
      syncCombatantActor(db, input.campaignId, combatant.combatantId, input);
  }
}

function lifecycleRepairedByReset(
  before: EncounterCombatant,
  after: CombatantLifecycleState,
): boolean {
  return (
    before.hpCurrent !== after.hpCurrent ||
    before.hpMax !== after.hpMax ||
    before.status !== after.status ||
    before.deathRules !== after.deathRules ||
    before.deathSaveSuccesses !== after.deathSaveSuccesses ||
    before.deathSaveFailures !== after.deathSaveFailures ||
    before.recoveryBlock !== after.recoveryBlock ||
    before.headCount !== after.headCount ||
    (before.stableRecoveryRoll ?? null) !==
      (after.stableRecovery?.roll ?? null) ||
    (before.stableRecoveryDeadlineElapsedMinutes ?? null) !==
      (after.stableRecovery?.deadline ?? null)
  );
}

export class EncounterCombatantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EncounterCombatantError';
  }
}

/** A state the engine's own guards make unreachable. Never translated into a
 *  cleanup action: callers must let it propagate. */
export class CombatantLifecycleInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CombatantLifecycleInvariantError';
  }
}

/** Validate canonical lifecycle after a combatant write, before its transaction commits. */
export function assertCombatantLifecycle(
  db: Db,
  campaignId: string,
  combatantId: string,
  previous?: EncounterCombatant,
): void {
  const c = readCombatant(db, campaignId, combatantId);
  if (!c) return;
  const row = db
    .prepare(`SELECT stable_recovery_settled, identity_kind, identity_ref FROM encounter_combatant
    WHERE campaign_id=? AND combatant_id=?`)
    .get(campaignId, combatantId) as {
    stable_recovery_settled: number;
    identity_kind: string;
    identity_ref: string | null;
  };
  const exhaustion = exhaustionLevel(c.conditions);
  const schedule = [
    c.stableRecoveryRoll,
    c.stableRecoveryAnchorElapsedMinutes,
    c.stableRecoveryDeadlineElapsedMinutes,
  ];
  const present = schedule.filter((v) => v !== null).length;
  const ownsSchedule =
    row.identity_kind !== 'campaign_actor' ||
    row.identity_ref === null ||
    isCurrentActorProjection(db, campaignId, row.identity_ref, combatantId);
  const fail = (rule: string): never => {
    throw new EncounterCombatantError(
      `combatant lifecycle invariant ${rule} violated for '${combatantId}'`,
    );
  };
  if (exhaustion === 6 && c.status !== 'dead' && c.status !== 'absent')
    fail('I1 (exhaustion level 6 requires dead)');
  if (c.headCount === 0 && c.status !== 'dead' && c.status !== 'absent')
    fail('I2 (zero heads requires dead)');
  if (
    (c.status === 'dying' || c.status === 'stable') &&
    (c.deathRules !== 'player-character' || c.hpCurrent !== 0)
  )
    fail('I3 (dying/stable requires player-character rules at 0 HP)');
  if (
    c.deathRules === 'player-character' &&
    c.hpCurrent === 0 &&
    !['dying', 'stable', 'dead', 'absent'].includes(c.status)
  )
    fail('I4 (0 HP player-character state must be dying, stable, or dead)');
  if (c.recoveryBlock !== null && c.status !== 'dying')
    fail('I5 (recovery block requires dying)');
  if (c.hpCurrent > effectiveHpMax(c.hpMax, c.conditions))
    fail('I6 (HP exceeds effective maximum)');
  if (
    (c.status !== 'stable' && present !== 0) ||
    (present > 0 && present !== 3) ||
    (!ownsSchedule && present > 0) ||
    (row.stable_recovery_settled === 1 &&
      (c.status !== 'stable' || present !== 0)) ||
    (c.status === 'stable' &&
      present === 0 &&
      row.stable_recovery_settled !== 1 &&
      ownsSchedule)
  )
    fail('I7 (stable recovery schedule is incomplete or unsettled)');
  // I8 (D2 reversed): dead is terminal in both death-rule modes, except that
  // it may become absent (removed from play by its owning effect).
  if (
    previous?.status === 'dead' &&
    c.status !== 'dead' &&
    c.status !== 'absent'
  )
    fail('I8 (dead state is terminal)');
  if (previous?.status === 'absent' && c.status !== 'absent')
    fail('I9 (absent never returns to another status on the same row)');
  if (
    c.status === 'absent' &&
    (c.recoveryBlock !== null ||
      c.deathSaveSuccesses !== 0 ||
      c.deathSaveFailures !== 0 ||
      present !== 0 ||
      row.stable_recovery_settled === 1)
  )
    fail(
      'I10 (absent requires no recovery block, no schedule, and zero death-save counters)',
    );
  if (
    c.zeroHpRule !== null &&
    (c.deathRules === 'player-character' ||
      (leavesPlayAtZeroHp(c.zeroHpRule) &&
        c.hpCurrent === 0 &&
        c.status !== 'absent' &&
        !(c.status === 'dead' && (exhaustion === 6 || c.headCount === 0))))
  )
    fail(
      'I11 (a creature with a 0-hit-point rule cannot use player-character death rules or stay present at 0 HP)',
    );
}

function readCombatantLifecycleState(
  db: Db,
  combatant: EncounterCombatant,
  overrides: { conditions?: readonly CharacterConditionEntry[] } = {},
): CombatantLifecycleState {
  const row = db
    .prepare(`SELECT heads_died_since_own_turn, fire_damage_since_own_turn,
      damage_this_turn, damage_turn_key, head_died_this_turn,
      stable_recovery_settled, zero_hp_rule, identity_kind, identity_ref FROM encounter_combatant
      WHERE campaign_id=? AND combatant_id=?`)
    .get(combatant.campaignId, combatant.combatantId) as
    | {
        heads_died_since_own_turn: number;
        fire_damage_since_own_turn: number;
        damage_this_turn: number;
        damage_turn_key: string | null;
        head_died_this_turn: number;
        stable_recovery_settled: number;
        zero_hp_rule: ZeroHpRule | null;
        identity_kind: string;
        identity_ref: string | null;
      }
    | undefined;
  if (!row)
    throw new EncounterCombatantError(
      `combatant '${combatant.combatantId}' disappeared during lifecycle transition`,
    );
  const scheduleParts = [
    combatant.stableRecoveryRoll,
    combatant.stableRecoveryAnchorElapsedMinutes,
    combatant.stableRecoveryDeadlineElapsedMinutes,
  ];
  const present = scheduleParts.filter((value) => value !== null).length;
  if (present !== 0 && present !== 3)
    throw new EncounterCombatantError(
      `combatant '${combatant.combatantId}' has a partial stable recovery schedule`,
    );
  const conditions = overrides.conditions ?? combatant.conditions;
  return {
    status: combatant.status,
    hpCurrent: combatant.hpCurrent,
    hpMax: combatant.hpMax,
    effectiveHpMax: effectiveHpMax(combatant.hpMax, conditions),
    deathRules: combatant.deathRules,
    exhaustionLevel: exhaustionLevel(conditions),
    deathSaveSuccesses: combatant.deathSaveSuccesses,
    deathSaveFailures: combatant.deathSaveFailures,
    recoveryBlock: combatant.recoveryBlock,
    stableRecovery:
      present === 0
        ? null
        : {
            roll: combatant.stableRecoveryRoll as number,
            anchor: combatant.stableRecoveryAnchorElapsedMinutes as number,
            deadline: combatant.stableRecoveryDeadlineElapsedMinutes as number,
          },
    stableRecoverySettled: row.stable_recovery_settled === 1,
    projectionOwner:
      row.identity_kind !== 'campaign_actor' ||
      row.identity_ref === null ||
      isCurrentActorProjection(
        db,
        combatant.campaignId,
        row.identity_ref,
        combatant.combatantId,
      ),
    headCount: combatant.headCount,
    headsDiedSinceOwnTurn: row.heads_died_since_own_turn,
    fireDamageSinceOwnTurn: row.fire_damage_since_own_turn,
    damageThisTurn: row.damage_this_turn,
    damageTurnKey: row.damage_turn_key,
    headDiedThisTurn: row.head_died_this_turn,
    zeroHpRule: row.zero_hp_rule,
  };
}

function transitionCombatantLifecycle(
  current: CombatantLifecycleState,
  event: CombatantLifecycleEvent,
  recoverySchedule?: StableRecoverySchedule,
): CombatantLifecycleState {
  const result = nextCombatantLifecycle(
    current,
    event,
    recoverySchedule === undefined ? {} : { recoverySchedule },
  );
  if (!result.ok) throw new EncounterCombatantError(result.refusal);
  return result.state;
}

function admitCombatantLifecycle(
  db: Db,
  campaignId: string,
  combatantId: string,
  ctx: { provenance: string; sessionId: string; at: string },
): CombatantLifecycleState {
  const combatant = readCombatant(db, campaignId, combatantId);
  if (!combatant)
    throw new EncounterCombatantError(`unknown combatant '${combatantId}'`);
  const lifecycle = transitionCombatantLifecycle(
    readCombatantLifecycleState(db, combatant),
    {
      type: 'admission',
      suppliedHp: combatant.hpCurrent,
      suppliedStatus: combatant.status,
      deathRules: combatant.deathRules,
      headCount: combatant.headCount,
    },
  );
  persistCombatantLifecycle(db, combatant, lifecycle, ctx);
  assertCombatantLifecycle(db, campaignId, combatantId, combatant);
  return lifecycle;
}

function newStableRecoverySchedule(db: Db, rng: Rng): StableRecoverySchedule {
  const clock = db
    .prepare('SELECT elapsed_minutes FROM clock WHERE id=1')
    .get() as { elapsed_minutes?: number } | undefined;
  if (
    clock === undefined ||
    !Number.isSafeInteger(clock.elapsed_minutes) ||
    (clock.elapsed_minutes as number) < 0
  )
    throw new EncounterCombatantError(
      'campaign clock elapsed_minutes is malformed',
    );
  const roll = rollDice('1d4', rng).total;
  const anchor = clock.elapsed_minutes as number;
  const deadline = anchor + roll * 60;
  if (!Number.isSafeInteger(deadline))
    throw new EncounterCombatantError(
      'stable recovery deadline exceeds safe integer range',
    );
  return { roll, anchor, deadline };
}

function persistCombatantLifecycle(
  db: Db,
  combatant: EncounterCombatant,
  lifecycle: CombatantLifecycleState,
  ctx: { provenance: string; sessionId: string; at: string },
): void {
  db.prepare(`UPDATE encounter_combatant SET
    hp_current=?, hp_max=?, status=?, death_rules=?, death_save_successes=?,
    death_save_failures=?, recovery_block=?, stable_recovery_roll=?,
    stable_recovery_anchor_elapsed_minutes=?,
    stable_recovery_deadline_elapsed_minutes=?, stable_recovery_settled=?,
    head_count=?, heads_died_since_own_turn=?, fire_damage_since_own_turn=?,
    damage_this_turn=?, damage_turn_key=?, head_died_this_turn=?,
    provenance=?, session_id=?, updated_at=?
    WHERE campaign_id=? AND combatant_id=?`).run(
    lifecycle.hpCurrent,
    lifecycle.hpMax,
    lifecycle.status,
    lifecycle.deathRules,
    lifecycle.deathSaveSuccesses,
    lifecycle.deathSaveFailures,
    lifecycle.recoveryBlock,
    lifecycle.stableRecovery?.roll ?? null,
    lifecycle.stableRecovery?.anchor ?? null,
    lifecycle.stableRecovery?.deadline ?? null,
    lifecycle.stableRecoverySettled ? 1 : 0,
    lifecycle.headCount,
    lifecycle.headsDiedSinceOwnTurn,
    lifecycle.fireDamageSinceOwnTurn,
    lifecycle.damageThisTurn,
    lifecycle.damageTurnKey,
    lifecycle.headDiedThisTurn,
    ctx.provenance,
    ctx.sessionId,
    ctx.at,
    combatant.campaignId,
    combatant.combatantId,
  );
}

function assertCampaignActorLifecycle(actor: CampaignActor): void {
  const lifecycle = readCombatLifecycle(actor.state);
  const exhaustion = exhaustionLevel(actor.conditions);
  const fail = (rule: string): never => {
    throw new EncounterCombatantError(
      `campaign actor lifecycle invariant ${rule} violated for '${actor.actorId}'`,
    );
  };
  if (exhaustion === 6 && actor.status !== 'dead' && actor.status !== 'absent')
    fail('I1');
  if (
    actor.hpCurrent !== undefined &&
    actor.hpMax !== undefined &&
    actor.hpCurrent > effectiveHpMax(actor.hpMax, actor.conditions)
  )
    fail('I6');
  if (!lifecycle) return;
  if (
    lifecycle.headCount === 0 &&
    actor.status !== 'dead' &&
    actor.status !== 'absent'
  )
    fail('I2');
  if (
    (actor.status === 'dying' || actor.status === 'stable') &&
    (lifecycle.deathRules !== 'player-character' || actor.hpCurrent !== 0)
  )
    fail('I3');
  if (
    lifecycle.deathRules === 'player-character' &&
    actor.hpCurrent === 0 &&
    !['dying', 'stable', 'dead', 'absent'].includes(actor.status)
  )
    fail('I4');
  if (
    actor.status === 'absent' &&
    (lifecycle.recoveryBlock !== null ||
      lifecycle.deathSaveSuccesses !== 0 ||
      lifecycle.deathSaveFailures !== 0 ||
      lifecycle.stableRecovery !== null ||
      lifecycle.stableRecoverySettled)
  )
    fail('I10');
  if (lifecycle.recoveryBlock !== null && actor.status !== 'dying') fail('I5');
  if (
    (lifecycle.stableRecovery !== null && actor.status !== 'stable') ||
    (lifecycle.stableRecoverySettled &&
      (actor.status !== 'stable' || lifecycle.stableRecovery !== null)) ||
    (actor.status === 'stable' &&
      lifecycle.stableRecovery === null &&
      !lifecycle.stableRecoverySettled)
  )
    fail('I7');
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
  if (c.status === 'absent')
    throw new EncounterCombatantError(
      `combatant '${c.combatantId}' is absent (out of play) and takes no part in combat`,
    );
}

function currentActorProjectionId(
  db: Db,
  campaignId: string,
  actorId: string,
): string | undefined {
  const row = db
    .prepare(`SELECT c.combatant_id FROM encounter_combatant c JOIN combat_instance i USING(campaign_id,combat_instance_id)
    WHERE c.campaign_id=? AND c.identity_kind='campaign_actor' AND c.identity_ref=?
    ORDER BY (i.status='active') DESC, i.rowid DESC LIMIT 1`)
    .get(campaignId, actorId) as { combatant_id: string } | undefined;
  return row?.combatant_id;
}

function isCurrentActorProjection(
  db: Db,
  campaignId: string,
  actorId: string,
  combatantId: string,
): boolean {
  return currentActorProjectionId(db, campaignId, actorId) === combatantId;
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
  readonly zero_hp_rule: ZeroHpRule | null;
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
  headsDiedSinceOwnTurn: number;
  fireDamageSinceOwnTurn: number;
  stableRecoverySettled: boolean;
  zeroHpRule: ZeroHpRule | null;
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
      (!Number.isInteger(v.headCount) || (v.headCount as number) < 0)) ||
    (v.headsDiedSinceOwnTurn !== undefined &&
      (!Number.isInteger(v.headsDiedSinceOwnTurn) ||
        (v.headsDiedSinceOwnTurn as number) < 0)) ||
    (v.fireDamageSinceOwnTurn !== undefined &&
      v.fireDamageSinceOwnTurn !== 0 &&
      v.fireDamageSinceOwnTurn !== 1) ||
    (v.stableRecoverySettled !== undefined &&
      typeof v.stableRecoverySettled !== 'boolean') ||
    (v.zeroHpRule !== undefined &&
      v.zeroHpRule !== null &&
      v.zeroHpRule !== 'vanish' &&
      v.zeroHpRule !== 'vanish-bonded' &&
      v.zeroHpRule !== 'revert-object' &&
      v.zeroHpRule !== 'revert-form')
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
    stableRecoverySettled: v.stableRecoverySettled === true,
    headCount: v.headCount as number | null,
    headsDiedSinceOwnTurn: (v.headsDiedSinceOwnTurn as number | undefined) ?? 0,
    fireDamageSinceOwnTurn:
      (v.fireDamageSinceOwnTurn as number | undefined) ?? 0,
    zeroHpRule: (v.zeroHpRule as ZeroHpRule | null | undefined) ?? null,
  };
}

function withoutCombatLifecycle(
  state: Record<string, JsonValue>,
): Record<string, JsonValue> {
  const { combatLifecycle: _dropped, ...rest } = state;
  return rest;
}

/** Actor state for a creature that left play: no life-state bookkeeping
 *  survives (absent requires zero counters, no schedule, no block). */
function absentActorState(
  state: Record<string, JsonValue>,
): Record<string, JsonValue> {
  const lifecycle = state.combatLifecycle;
  if (
    typeof lifecycle !== 'object' ||
    lifecycle === null ||
    Array.isArray(lifecycle)
  )
    return state;
  return {
    ...state,
    combatLifecycle: {
      ...lifecycle,
      deathSaveSuccesses: 0,
      deathSaveFailures: 0,
      recoveryBlock: null,
      stableRecovery: null,
      stableRecoverySettled: false,
    },
  };
}

function combatLifecycleForCombatant(
  db: Db,
  campaignId: string,
  combatantId: string,
): Record<string, JsonValue> {
  const c = readCombatant(db, campaignId, combatantId);
  if (!c)
    throw new EncounterCombatantError(`unknown combatant '${combatantId}'`);
  const lifecycle = transitionCombatantLifecycle(
    readCombatantLifecycleState(db, c),
    {
      type: 'admission',
      suppliedHp: c.hpCurrent,
      suppliedStatus: c.status,
      deathRules: c.deathRules,
      headCount: c.headCount,
    },
  );
  return {
    deathRules: lifecycle.deathRules,
    deathSaveSuccesses: lifecycle.deathSaveSuccesses,
    deathSaveFailures: lifecycle.deathSaveFailures,
    recoveryBlock: lifecycle.recoveryBlock,
    stableRecovery: lifecycle.stableRecovery,
    stableRecoverySettled: lifecycle.stableRecoverySettled,
    headCount: lifecycle.headCount,
    headsDiedSinceOwnTurn: lifecycle.headsDiedSinceOwnTurn,
    fireDamageSinceOwnTurn: lifecycle.fireDamageSinceOwnTurn,
    zeroHpRule: lifecycle.zeroHpRule,
  } as unknown as Record<string, JsonValue>;
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
    zeroHpRule: row.zero_hp_rule,
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
  // Own the write boundary: any refusal rolls the stored row back even when
  // the caller supplied no enclosing transaction.
  return withTransaction(db, (txnDb) => upsertCampaignActorInTxn(txnDb, input));
}

function upsertCampaignActorInTxn(
  db: Db,
  input: UpsertCampaignActorInput,
): CampaignActor {
  const existing = getCampaignActor(db, input.campaignId, input.actorId);
  const nextState = { ...(input.state ?? {}) };
  if (
    !input.replaceCombatLifecycle &&
    existing?.state.combatLifecycle !== undefined
  )
    nextState.combatLifecycle = existing.state.combatLifecycle;
  // Validate the candidate (I1-I7, terminal transitions) BEFORE any SQL.
  const candidate: CampaignActor = {
    campaignId: input.campaignId,
    actorId: input.actorId,
    displayName: input.displayName,
    actorKind: input.actorKind,
    sourceKind: input.sourceKind,
    sourceRef: input.sourceRef,
    rulesRef: input.rulesRef,
    hpCurrent: input.hpCurrent,
    hpMax: input.hpMax,
    conditions: input.conditions ?? [],
    status: input.status ?? 'unknown',
    currentLocationId: input.currentLocationId,
    state: nextState,
  };
  readCombatLifecycle(candidate.state);
  if (
    existing?.status === 'dead' &&
    candidate.status !== 'dead' &&
    candidate.status !== 'absent'
  )
    throw new EncounterCombatantError(
      `campaign actor '${candidate.actorId}' is dead; use the lifecycle tools`,
    );
  assertCampaignActorLifecycle(candidate);
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
    JSON.stringify(nextState),
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
              stable_recovery_deadline_elapsed_minutes, head_count, zero_hp_rule
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
      const combatantId = `${combatInstanceId}-${baseId}-${ordinal}`;
      insertCombatant(db, {
        campaignId: input.campaignId,
        combatInstanceId,
        sourceEncounterId: input.encounterId,
        combatantId,
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
      admitCombatantLifecycle(db, input.campaignId, combatantId, input);
      ordinal += 1;
    }
  }

  for (const actorInput of input.actors ?? []) {
    if (actorInput.state?.combatLifecycle !== undefined)
      throw new EncounterCombatantError(
        'state.combatLifecycle is engine-owned and cannot be supplied when starting an encounter',
      );
    const existing = getCampaignActor(db, input.campaignId, actorInput.actorId);
    const rulesRef = actorInput.rulesRef ?? existing?.rulesRef;
    if (rulesRef === undefined) {
      throw new EncounterCombatantError(
        `actor '${actorInput.actorId}' needs rulesRef for combat projection`,
      );
    }
    if (existing?.status === 'absent') {
      // Admitting an absent actor is a new manifestation: it needs hit
      // points of its own and starts alive with a fresh lifecycle.
      if (actorInput.hpCurrent === undefined || actorInput.hpCurrent <= 0)
        throw new EncounterCombatantError(
          `campaign actor '${actorInput.actorId}' is absent (it vanished or was removed from play by its owning effect); admitting it again is a new manifestation and needs hpCurrent above 0`,
        );
      if (actorInput.status !== undefined && actorInput.status !== 'alive')
        throw new EncounterCombatantError(
          `campaign actor '${actorInput.actorId}' is absent; a new manifestation starts alive, not '${actorInput.status}'`,
        );
    }
    const record = lookupCreatureRecord(db, rulesRef, input.resolveRulesPack);
    const baselineHp = readCreatureHp(record);
    const hpMax = actorInput.hpMax ?? existing?.hpMax ?? baselineHp;
    // A new manifestation of an absent actor is a new creature: nothing from
    // the manifestation that left play (conditions, exhaustion, death rules,
    // 0-HP rule, heads) carries over; a new owning effect sets its own rules.
    const remanifest = existing?.status === 'absent';
    // An absent actor still held by an active actor link is a bonded
    // creature (familiar, steed: 'vanish-bonded'). S1 returns it only through
    // its spell: a Find Familiar cast restores presence, a Find Steed recast
    // restores the same steed to maximum hit points. That recast is not
    // executable yet (eshyra follow-up), so admission must not stand in for
    // it (S50). Ending the owning effect frees the actor; a later admission
    // is then a new creature.
    if (
      remanifest &&
      existing !== undefined &&
      db
        .prepare(
          `SELECT 1 FROM active_effect_link
           WHERE campaign_id = ? AND link_kind = 'actor' AND status = 'active'
             AND (campaign_actor_id = ?
               OR (target_kind = 'campaign_actor' AND target_ref = ?))
           LIMIT 1`,
        )
        .get(input.campaignId, existing.actorId, existing.actorId) !== undefined
    )
      throw new EncounterCombatantError(
        `campaign actor '${existing.actorId}' is absent but still bonded to its summoner (it disappeared at 0 hit points under its zero-hit-point rule); ` +
          'it returns only when its summoner casts its spell again (Find Familiar, or Find Steed at maximum hit points), which the engine cannot yet execute. ' +
          'Starting an encounter cannot bring it back; end the owning effect to release the bond if a new creature is wanted instead',
      );
    const conditions =
      actorInput.conditions ?? (remanifest ? [] : (existing?.conditions ?? []));
    const lifecycleBefore =
      existing && !remanifest ? readCombatLifecycle(existing.state) : undefined;
    const suppliedHp = actorInput.hpCurrent ?? existing?.hpCurrent ?? hpMax;
    if (
      existing &&
      ['dead', 'dying', 'stable'].includes(existing.status) &&
      ((actorInput.status !== undefined &&
        actorInput.status !== existing.status) ||
        (existing.status === 'dead' &&
          suppliedHp > (existing.hpCurrent ?? 0)) ||
        (existing.status !== 'dead' && suppliedHp > 0))
    )
      throw new EncounterCombatantError(
        `start_encounter cannot change a ${existing.status} campaign actor or supply replacement HP; use the lifecycle tools`,
      );
    if (
      lifecycleBefore?.recoveryBlock !== null &&
      lifecycleBefore?.recoveryBlock !== undefined &&
      suppliedHp > (existing?.hpCurrent ?? 0)
    )
      throw new EncounterCombatantError(
        'start_encounter cannot raise HP while recovery is blocked; use the lifecycle tools',
      );
    const actorHeadCount =
      lifecycleBefore?.headCount ?? initialHeadCount(record);
    const terminalCause =
      exhaustionLevel(conditions) === 6 || actorHeadCount === 0;
    if (
      terminalCause &&
      actorInput.status !== undefined &&
      actorInput.status !== 'dead'
    )
      throw new EncounterCombatantError(
        'start_encounter cannot admit a terminally dead creature as alive; use the lifecycle tools',
      );
    if (
      (lifecycleBefore?.deathRules === 'player-character' ||
        actorInput.status === 'dying' ||
        actorInput.status === 'stable') &&
      suppliedHp === 0 &&
      !['dead', 'dying', 'stable'].includes(
        actorInput.status ?? existing?.status ?? '',
      )
    )
      throw new EncounterCombatantError(
        'start_encounter cannot admit a 0 HP player-character as alive; use the lifecycle tools',
      );
    const hpCurrent = Math.min(
      actorInput.hpCurrent ?? existing?.hpCurrent ?? hpMax,
      effectiveHpMax(hpMax, conditions),
    );
    // A creature that leaves play or reverts at 0 hit points has no body at 0
    // HP: it cannot be admitted at 0 HP in any status (only a terminal death by exhaustion or
    // lost heads, already recorded, can stand at 0 HP).
    if (
      (leavesPlayAtZeroHp(lifecycleBefore?.zeroHpRule ?? null) ||
        revertsFormAtZeroHp(lifecycleBefore?.zeroHpRule ?? null)) &&
      hpCurrent === 0 &&
      !(existing?.status === 'dead' && terminalCause)
    )
      throw new EncounterCombatantError(
        `campaign actor '${actorInput.actorId}' ${describeZeroHpRule(lifecycleBefore?.zeroHpRule as ZeroHpRule)} at 0 hit points (its zero-hit-point rule), so it cannot be admitted at 0 hit points; ` +
          'reduce it to 0 with damage in play (its rule then applies) or admit it with hit points above 0',
      );
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
      status:
        existing?.status === 'absent'
          ? 'alive'
          : (actorInput.status ?? existing?.status ?? 'alive'),
      currentLocationId:
        actorInput.currentLocationId ??
        existing?.currentLocationId ??
        locationId,
      state: remanifest
        ? withoutCombatLifecycle(actorInput.state ?? existing?.state ?? {})
        : (actorInput.state ?? existing?.state),
      ...(remanifest ? { replaceCombatLifecycle: true } : {}),
      provenance: input.provenance,
      sessionId: input.sessionId,
      at: input.at,
    });
    const lifecycle = readCombatLifecycle(actor.state);
    // A new active row becomes the sole schedule owner via
    // isCurrentActorProjection's ordering. Historical rows retain their valid
    // lifecycle snapshots and are no longer eligible for clock resolution.
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
      hpCurrent: Math.min(
        actor.hpCurrent ?? hpMax,
        effectiveHpMax(actor.hpMax ?? hpMax, actor.conditions),
      ),
      hpMax: actor.hpMax ?? hpMax,
      ac: readCreatureAc(record),
      conditions: actor.conditions,
      status: terminalCause
        ? 'dead'
        : hpCurrent === 0
          ? (lifecycle?.deathRules ?? 'monster') === 'player-character'
            ? actor.status === 'stable' || actor.status === 'dead'
              ? actor.status
              : 'dying'
            : actor.status === 'dead'
              ? 'dead'
              : // A monster-rules creature at 0 HP with no terminal cause was
                // knocked out (its status may since have become inactive or
                // escaped); it is unconscious, never killed by projection
                // (S38, S41).
                'unconscious'
          : actorInput.status === undefined &&
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
       stable_recovery_anchor_elapsed_minutes=?, stable_recovery_deadline_elapsed_minutes=?,
       stable_recovery_settled=?, zero_hp_rule=?
       WHERE campaign_id=? AND combatant_id=?`,
    ).run(
      lifecycle?.deathRules ?? 'monster',
      lifecycle?.deathSaveSuccesses ?? 0,
      lifecycle?.deathSaveFailures ?? 0,
      lifecycle?.recoveryBlock ?? null,
      lifecycle?.stableRecovery?.roll ?? null,
      lifecycle?.stableRecovery?.anchor ?? null,
      lifecycle?.stableRecovery?.deadline ?? null,
      lifecycle?.stableRecoverySettled ? 1 : 0,
      lifecycle?.zeroHpRule ?? null,
      input.campaignId,
      projectedId,
    );
    if (lifecycle) {
      db.prepare(`UPDATE encounter_combatant SET heads_died_since_own_turn=?, fire_damage_since_own_turn=?
        WHERE campaign_id=? AND combatant_id=?`).run(
        lifecycle.headsDiedSinceOwnTurn,
        lifecycle.fireDamageSinceOwnTurn,
        input.campaignId,
        projectedId,
      );
    }
    admitCombatantLifecycle(db, input.campaignId, projectedId, input);
    const historicalRows = db
      .prepare(`SELECT combatant_id FROM encounter_combatant
        WHERE campaign_id=? AND identity_kind='campaign_actor' AND identity_ref=?
          AND combatant_id<>? ORDER BY combat_instance_id, combatant_id`)
      .all(input.campaignId, actor.actorId, projectedId) as Array<{
      combatant_id: string;
    }>;
    for (const historical of historicalRows) {
      const oldProjection = readCombatant(
        db,
        input.campaignId,
        historical.combatant_id,
      );
      if (!oldProjection) continue;
      const invalidated = transitionCombatantLifecycle(
        readCombatantLifecycleState(db, oldProjection),
        { type: 'invalidateProjection' },
      );
      persistCombatantLifecycle(db, oldProjection, invalidated, input);
      assertCombatantLifecycle(
        db,
        input.campaignId,
        oldProjection.combatantId,
        oldProjection,
      );
    }
    syncCombatantActor(db, input.campaignId, projectedId, input);
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
    resolveRulesPack: input.resolveRulesPack,
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
              stable_recovery_deadline_elapsed_minutes, head_count, zero_hp_rule
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
    // A natural 20 that cannot regain HP (blocked, or effective max 0) takes
    // the same capped-success path as an ordinary success, so a third success
    // on it stabilizes and needs the same seeded schedule (S34).
    const natural20Revives =
      roll === 20 &&
      c.recoveryBlock === null &&
      effectiveHpMax(c.hpMax, c.conditions) > 0;
    const needsSchedule =
      !natural20Revives &&
      roll >= 10 &&
      c.deathSaveSuccesses >= 2 &&
      c.recoveryBlock === null;
    const recoverySchedule = needsSchedule
      ? newStableRecoverySchedule(txn, rng)
      : undefined;
    const lifecycle = transitionCombatantLifecycle(
      readCombatantLifecycleState(txn, c),
      { type: 'deathSave', roll },
      recoverySchedule,
    );
    persistCombatantLifecycle(txn, c, lifecycle, ctx);
    const outcome =
      roll === 20
        ? natural20Revives
          ? 'revived'
          : lifecycle.status === 'stable'
            ? 'stabilized'
            : 'success'
        : roll === 1
          ? lifecycle.status === 'dead'
            ? 'dead'
            : 'critical-failure'
          : roll >= 10
            ? lifecycle.status === 'stable'
              ? 'stabilized'
              : 'success'
            : lifecycle.status === 'dead'
              ? 'dead'
              : 'failure';
    const {
      hpCurrent,
      deathSaveSuccesses: successes,
      deathSaveFailures: failures,
    } = lifecycle;
    const status = lifecycle.status;
    assertCombatantLifecycle(txn, campaignId, combatantId, c);
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
    const recoverySchedule = newStableRecoverySchedule(txn, rng);
    const lifecycle = transitionCombatantLifecycle(
      readCombatantLifecycleState(txn, c),
      { type: 'stabilize' },
      recoverySchedule,
    );
    persistCombatantLifecycle(txn, c, lifecycle, ctx);
    syncCombatantActor(txn, campaignId, combatantId, ctx);
    assertCombatantLifecycle(txn, campaignId, combatantId, c);
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
      c.status === 'stable' ||
      c.status === 'absent';
    const shouldStabilize =
      event === 'breathe' && c.status === 'dying' && c.deathSaveSuccesses >= 3;
    const recoverySchedule = shouldStabilize
      ? newStableRecoverySchedule(txn, rng)
      : undefined;
    const lifecycle = transitionCombatantLifecycle(
      readCombatantLifecycleState(txn, c),
      { type: event === 'drop' ? 'suffocationDrop' : 'suffocationBreathe' },
      recoverySchedule,
    );
    persistCombatantLifecycle(txn, c, lifecycle, ctx);
    let reverted: RevertedOutcome | undefined;
    if (
      event === 'drop' &&
      revertsFormAtZeroHp(c.zeroHpRule) &&
      c.hpCurrent > 0 &&
      lifecycle.hpCurrent === 0 &&
      lifecycle.status !== 'dead'
    ) {
      const atZero = readCombatant(txn, campaignId, combatantId);
      if (atZero === undefined)
        throw new EncounterCombatantError('unknown combatant');
      reverted = completeZeroHpFormReversion(txn, atZero, ctx);
    }
    const settledNow =
      reverted === undefined
        ? lifecycle
        : (readCombatant(txn, campaignId, combatantId) ?? lifecycle);
    const isDown =
      settledNow.hpCurrent === 0 ||
      settledNow.status === 'dead' ||
      settledNow.status === 'unconscious' ||
      settledNow.status === 'inactive' ||
      settledNow.status === 'dying' ||
      settledNow.status === 'stable' ||
      settledNow.status === 'absent';
    if (!wasDown && isDown)
      breakCombatantConcentration(
        txn,
        campaignId,
        combatantId,
        settledNow.status === 'dead'
          ? 'dead'
          : settledNow.status === 'absent'
            ? 'owner-removed'
            : 'incapacitated',
        ctx,
      );
    syncCombatantActor(txn, campaignId, combatantId, ctx);
    assertCombatantLifecycle(txn, campaignId, combatantId, c);
    let vanished: VanishedOutcome | undefined;
    if (c.status !== 'absent' && lifecycle.status === 'absent') {
      // A drop is not damage: nothing carries over to an original object form.
      if (c.zeroHpRule === 'revert-object')
        reverted = completeZeroHpObjectReversion(txn, c, 0, ctx);
      else vanished = completeZeroHpVanish(txn, c, ctx);
    }
    return {
      lifeState: settledNow.status,
      hpCurrent: settledNow.hpCurrent,
      ...(vanished === undefined ? {} : { vanished }),
      ...(reverted === undefined ? {} : { reverted }),
    };
  });
}

export function resolveCombatantRecoveries(
  db: Db,
  elapsed: number,
  ctx: { provenance: string; sessionId: string; at: string },
) {
  return withTransaction(db, (txn) => {
    const recoveryRows = txn
      .prepare(`SELECT campaign_id, combatant_id, status, hp_current,
        stable_recovery_roll, stable_recovery_anchor_elapsed_minutes,
        stable_recovery_deadline_elapsed_minutes, stable_recovery_settled,
        identity_kind, identity_ref FROM encounter_combatant
        ORDER BY campaign_id, combatant_id`)
      .all() as Array<{
      campaign_id: string;
      combatant_id: string;
      status: string;
      hp_current: number;
      stable_recovery_roll: number | null;
      stable_recovery_anchor_elapsed_minutes: number | null;
      stable_recovery_deadline_elapsed_minutes: number | null;
      stable_recovery_settled: number;
      identity_kind: string;
      identity_ref: string | null;
    }>;
    const malformed = recoveryRows.filter((row) => {
      const schedule = [
        row.stable_recovery_roll,
        row.stable_recovery_anchor_elapsed_minutes,
        row.stable_recovery_deadline_elapsed_minutes,
      ];
      const present = schedule.filter((value) => value !== null).length;
      const owner =
        row.identity_kind !== 'campaign_actor' ||
        row.identity_ref === null ||
        isCurrentActorProjection(
          txn,
          row.campaign_id,
          row.identity_ref,
          row.combatant_id,
        );
      const partial = present !== 0 && present !== 3;
      return (
        (!owner && present > 0) ||
        (row.status === 'stable' &&
          (row.hp_current !== 0 ||
            partial ||
            (row.stable_recovery_settled === 1 && present !== 0) ||
            (owner && present === 0 && row.stable_recovery_settled !== 1))) ||
        (row.status !== 'stable' &&
          (present > 0 || row.stable_recovery_settled === 1))
      );
    });
    if (malformed.length)
      throw new EncounterCombatantError(
        `stable recovery state is malformed for combatant(s): ${malformed.map((x) => x.combatant_id).join(', ')}`,
      );
    const candidates = txn
      .prepare(
        `SELECT c.campaign_id,c.combatant_id,c.combat_instance_id,c.identity_kind,c.identity_ref
         FROM encounter_combatant c JOIN combat_instance i USING(campaign_id,combat_instance_id)
         WHERE c.status='stable' AND c.hp_current=0 AND c.stable_recovery_settled=0 AND c.stable_recovery_deadline_elapsed_minutes<=?
         ORDER BY c.stable_recovery_deadline_elapsed_minutes,c.combatant_id`,
      )
      .all(elapsed) as Array<{ campaign_id: string; combatant_id: string }>;
    const rows = candidates.filter((row) => {
      const c = readCombatant(txn, row.campaign_id, row.combatant_id);
      return (
        c?.identityKind !== 'campaign_actor' ||
        (c.identityRef !== undefined &&
          isCurrentActorProjection(
            txn,
            row.campaign_id,
            c.identityRef,
            c.combatantId,
          ))
      );
    });
    for (const row of rows) {
      const combatant = readCombatant(txn, row.campaign_id, row.combatant_id);
      if (!combatant) continue;
      const lifecycle = transitionCombatantLifecycle(
        readCombatantLifecycleState(txn, combatant),
        { type: 'recoveryDue', elapsedMinutes: elapsed },
      );
      persistCombatantLifecycle(txn, combatant, lifecycle, ctx);
      syncCombatantActor(txn, row.campaign_id, row.combatant_id, ctx);
      assertCombatantLifecycle(
        txn,
        row.campaign_id,
        row.combatant_id,
        combatant,
      );
    }
    return rows.length;
  });
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
  const pending = db
    .prepare(`SELECT heads_died_since_own_turn, fire_damage_since_own_turn, stable_recovery_settled
    FROM encounter_combatant WHERE campaign_id=? AND combatant_id=?`)
    .get(campaignId, id) as {
    heads_died_since_own_turn: number;
    fire_damage_since_own_turn: number;
    stable_recovery_settled: number;
  };
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
      stableRecoverySettled: pending.stable_recovery_settled === 1,
      headCount: c.headCount,
      headsDiedSinceOwnTurn: pending.heads_died_since_own_turn,
      fireDamageSinceOwnTurn: pending.fire_damage_since_own_turn,
      zeroHpRule: c.zeroHpRule,
    } as unknown as JsonValue,
  };
  upsertCampaignActor(db, {
    campaignId,
    actorId: c.identityRef,
    displayName: a.displayName,
    actorKind: a.actorKind,
    sourceKind: a.sourceKind,
    sourceRef: a.sourceRef,
    rulesRef: c.rulesRef,
    hpCurrent: c.hpCurrent,
    hpMax: c.hpMax,
    conditions: c.conditions,
    status: c.status,
    currentLocationId: c.locationId,
    state,
    replaceCombatLifecycle: true,
    provenance: ctx.provenance,
    sessionId: ctx.sessionId,
    at: ctx.at,
  });
}

function completeZeroHpVanish(
  db: Db,
  before: EncounterCombatant,
  ctx: {
    provenance: string;
    sessionId: string;
    at: string;
    resolveRulesPack?: CampaignRulesPackResolver;
  },
): VanishedOutcome {
  const bonded = before.zeroHpRule === 'vanish-bonded';
  const closed = closeActorLinkAtZeroHp(
    db,
    before.campaignId,
    {
      combatantId: before.combatantId,
      ...(before.identityKind === 'campaign_actor' &&
      before.identityRef !== undefined
        ? { actorId: before.identityRef }
        : {}),
    },
    ctx,
    bonded ? 'keep' : 'close',
  );
  return {
    rule: bonded ? 'vanish-bonded' : 'vanish',
    effectId: closed.effectId,
    effectEnded: closed.effectEnded,
    // Only a bond that actually survives is reported as kept.
    linkKept: bonded && closed.effectId !== null,
  };
}

/** Aftermath of a 0-hit-point 'revert-object' (same transaction): the animated
 *  creature has left play (status absent) as its object form; its link closes
 *  with reason zero-hit-points and the effect ends when it was the last owned
 *  creature. Objects are not tracked, so the damage beyond the hit points the
 *  creature had is reported as carried over, never stored. */
function completeZeroHpObjectReversion(
  db: Db,
  before: EncounterCombatant,
  carriedOverDamage: number,
  ctx: EffectCtx,
): RevertedOutcome {
  const closed = closeActorLinkAtZeroHp(
    db,
    before.campaignId,
    holderOf(before),
    ctx,
    'close',
  );
  return {
    rule: 'revert-object',
    effectId: closed.effectId,
    effectEnded: closed.effectEnded,
    carriedOverDamage,
  };
}

/** Aftermath of a 0-hit-point 'revert-form' (same transaction): restore the
 *  natural form recorded on the creature's active link, then close that link
 *  (reason zero-hit-points); the effect ends when it was the last owned
 *  creature. Refuses, rolling the transaction back, when no natural form was
 *  ever recorded (a legacy row). */
function completeZeroHpFormReversion(
  db: Db,
  before: EncounterCombatant,
  ctx: EffectCtx,
): RevertedOutcome {
  const found = findActiveNaturalForm(db, before.campaignId, holderOf(before));
  if (found?.naturalForm === undefined)
    throw new EncounterCombatantError(noNaturalFormMessage(before.combatantId));
  const restored = applyNaturalForm(db, before, found.naturalForm, ctx);
  const closed = closeActorLinkAtZeroHp(
    db,
    before.campaignId,
    holderOf(before),
    ctx,
    'close',
    'reverted-form',
  );
  return {
    rule: 'revert-form',
    effectId: closed.effectId,
    effectEnded: closed.effectEnded,
    naturalForm: restored,
  };
}

type EffectCtx = {
  provenance: string;
  sessionId: string;
  at: string;
  resolveRulesPack?: CampaignRulesPackResolver;
};

function holderOf(c: EncounterCombatant): {
  combatantId: string;
  actorId?: string;
} {
  return {
    combatantId: c.combatantId,
    ...(c.identityKind === 'campaign_actor' && c.identityRef !== undefined
      ? { actorId: c.identityRef }
      : {}),
  };
}

/** Restore a combatant row to its natural form: the recorded rules reference
 *  and maximum, the recorded current hit points clamped to the effective
 *  maximum (exhaustion still applies), alive, with the 0-hit-point rule and
 *  life-state bookkeeping cleared. Conditions stay: it is the same creature.
 *  Returns the hit points and form actually restored. */
function applyNaturalForm(
  db: Db,
  current: EncounterCombatant,
  form: NaturalForm,
  ctx: EffectCtx,
): NaturalForm {
  const hpCurrent = Math.min(
    form.hpCurrent,
    effectiveHpMax(form.hpMax, current.conditions),
  );
  const record = lookupCreatureRecord(db, form.rulesRef, ctx.resolveRulesPack);
  db.prepare(
    `UPDATE encounter_combatant SET hp_current=?, hp_max=?, rules_ref=?, ac=?,
       status=?, zero_hp_rule=NULL, death_save_successes=0, death_save_failures=0,
       recovery_block=NULL, stable_recovery_roll=NULL,
       stable_recovery_anchor_elapsed_minutes=NULL,
       stable_recovery_deadline_elapsed_minutes=NULL, stable_recovery_settled=0,
       provenance=?, session_id=?, updated_at=?
     WHERE campaign_id=? AND combatant_id=?`,
  ).run(
    hpCurrent,
    form.hpMax,
    form.rulesRef,
    readCreatureAc(record) ?? null,
    hpCurrent === 0 ? 'dead' : 'alive',
    ctx.provenance,
    ctx.sessionId,
    ctx.at,
    current.campaignId,
    current.combatantId,
  );
  syncCombatantActor(db, current.campaignId, current.combatantId, ctx);
  assertCombatantLifecycle(db, current.campaignId, current.combatantId);
  return { hpCurrent, hpMax: form.hpMax, rulesRef: form.rulesRef };
}

/** F3 revert seam for an owned combatant: restore its natural form and leave
 *  it in play. 'missing' when the holder is unreachable, or is dead or
 *  already out of play (nothing to restore). */
export function revertCombatantToNaturalForm(
  db: Db,
  input: {
    readonly campaignId: string;
    readonly combatantId: string;
    readonly naturalForm: NaturalForm;
    readonly resolveRulesPack?: CampaignRulesPackResolver;
    readonly provenance: string;
    readonly sessionId: string;
    readonly at: string;
  },
): 'reverted' | 'missing' {
  return withTransaction(db, (txn) => {
    const current = readCombatant(txn, input.campaignId, input.combatantId);
    if (current === undefined) return 'missing';
    if (
      readCombatInstance(txn, input.campaignId, current.combatInstanceId)
        ?.status !== 'active'
    )
      return 'missing';
    if (current.status === 'absent' || current.status === 'dead')
      return 'missing';
    applyNaturalForm(txn, current, input.naturalForm, input);
    return 'reverted';
  });
}

/** F3 revert seam for a durable (campaign actor) link: the actor, or its
 *  active projection when there is one, returns to its natural form. */
export function revertCampaignActorToNaturalForm(
  db: Db,
  input: {
    readonly campaignId: string;
    readonly actorId: string;
    readonly naturalForm: NaturalForm;
    readonly resolveRulesPack?: CampaignRulesPackResolver;
    readonly provenance: string;
    readonly sessionId: string;
    readonly at: string;
  },
): 'reverted' | 'missing' {
  return withTransaction(db, (txn) => {
    const actor = getCampaignActor(txn, input.campaignId, input.actorId);
    if (actor === undefined) return 'missing';
    const projection = txn
      .prepare(
        `SELECT combatant_id FROM encounter_combatant
         WHERE campaign_id = ? AND identity_kind = 'campaign_actor' AND identity_ref = ?
           AND combat_instance_id IN (SELECT combat_instance_id FROM combat_instance WHERE campaign_id = ? AND status = 'active')
         ORDER BY combatant_id LIMIT 1`,
      )
      .get(input.campaignId, input.actorId, input.campaignId) as
      | { combatant_id: string }
      | undefined;
    if (projection !== undefined)
      return revertCombatantToNaturalForm(txn, {
        ...input,
        combatantId: projection.combatant_id,
      });
    if (actor.status === 'absent' || actor.status === 'dead') return 'missing';
    const form = input.naturalForm;
    const hpCurrent = Math.min(
      form.hpCurrent,
      effectiveHpMax(form.hpMax, actor.conditions),
    );
    upsertCampaignActor(txn, {
      campaignId: input.campaignId,
      actorId: actor.actorId,
      displayName: actor.displayName,
      actorKind: actor.actorKind,
      sourceKind: actor.sourceKind,
      sourceRef: actor.sourceRef,
      rulesRef: form.rulesRef,
      hpCurrent,
      hpMax: form.hpMax,
      conditions: actor.conditions,
      status: hpCurrent === 0 ? 'dead' : 'alive',
      currentLocationId: actor.currentLocationId,
      state: revertedActorState(actor.state),
      replaceCombatLifecycle: true,
      provenance: input.provenance,
      sessionId: input.sessionId,
      at: input.at,
    });
    return 'reverted';
  });
}

/** F3 remove seam for an owned combatant: take it out of play (status
 *  absent). 'missing' only when the holder is truly unreachable. A dying or
 *  stable creature is unreachable by construction and raises an invariant
 *  error instead of being translated into another cleanup action. */
export function removeCombatantFromPlay(
  db: Db,
  input: {
    readonly campaignId: string;
    readonly combatantId: string;
    readonly resolveRulesPack?: CampaignRulesPackResolver;
    readonly provenance: string;
    readonly sessionId: string;
    readonly at: string;
  },
): 'removed' | 'missing' {
  return withTransaction(db, (txn) => {
    const current = readCombatant(txn, input.campaignId, input.combatantId);
    if (current === undefined) return 'missing';
    if (
      readCombatInstance(txn, input.campaignId, current.combatInstanceId)
        ?.status !== 'active'
    )
      return 'missing';
    if (current.status === 'absent') return 'removed';
    if (current.status === 'dying' || current.status === 'stable')
      throw new CombatantLifecycleInvariantError(
        `combatant '${current.combatantId}' is ${current.status} under a remove-policy owner; the engine guards make this state unreachable`,
      );
    const lifecycle = transitionCombatantLifecycle(
      readCombatantLifecycleState(txn, current),
      { type: 'removeFromPlay' },
    );
    persistCombatantLifecycle(txn, current, lifecycle, input);
    assertCombatantLifecycle(txn, input.campaignId, input.combatantId, current);
    syncCombatantActor(txn, input.campaignId, input.combatantId, input);
    // F3 reaction, as for any other way of leaving active play: concentration
    // ends with the owner (transition-gated).
    const wasIncapacitated =
      current.hpCurrent === 0 ||
      ['dead', 'unconscious', 'inactive'].includes(current.status) ||
      anyConditionImpliesIncapacitated(
        txn,
        current.conditions.map((c) => c.id),
        input.resolveRulesPack,
      );
    if (!wasIncapacitated)
      breakCombatantConcentration(
        txn,
        input.campaignId,
        input.combatantId,
        'owner-removed',
        {
          provenance: input.provenance,
          sessionId: input.sessionId,
          at: input.at,
          ...(input.resolveRulesPack === undefined
            ? {}
            : { resolveRulesPack: input.resolveRulesPack }),
        },
      );
    return 'removed';
  });
}

/** F3 remove seam for a durable (campaign actor) link: the actor and its
 *  active projection, when there is one, become absent. */
export function removeCampaignActorFromPlay(
  db: Db,
  input: {
    readonly campaignId: string;
    readonly actorId: string;
    readonly resolveRulesPack?: CampaignRulesPackResolver;
    readonly provenance: string;
    readonly sessionId: string;
    readonly at: string;
  },
): 'removed' | 'missing' {
  return withTransaction(db, (txn) => {
    const actor = getCampaignActor(txn, input.campaignId, input.actorId);
    if (actor === undefined) return 'missing';
    const projection = txn
      .prepare(
        `SELECT combatant_id FROM encounter_combatant
         WHERE campaign_id = ? AND identity_kind = 'campaign_actor' AND identity_ref = ?
           AND combat_instance_id IN (SELECT combat_instance_id FROM combat_instance WHERE campaign_id = ? AND status = 'active')
         ORDER BY combatant_id LIMIT 1`,
      )
      .get(input.campaignId, input.actorId, input.campaignId) as
      | { combatant_id: string }
      | undefined;
    if (projection !== undefined)
      return removeCombatantFromPlay(txn, {
        ...input,
        combatantId: projection.combatant_id,
      });
    if (actor.status === 'absent') return 'removed';
    if (actor.status === 'dying' || actor.status === 'stable')
      throw new CombatantLifecycleInvariantError(
        `campaign actor '${actor.actorId}' is ${actor.status} under a remove-policy owner; the engine guards make this state unreachable`,
      );
    upsertCampaignActor(txn, {
      campaignId: input.campaignId,
      actorId: actor.actorId,
      displayName: actor.displayName,
      actorKind: actor.actorKind,
      sourceKind: actor.sourceKind,
      sourceRef: actor.sourceRef,
      rulesRef: actor.rulesRef,
      hpCurrent: actor.hpCurrent,
      hpMax: actor.hpMax,
      conditions: actor.conditions,
      status: 'absent',
      currentLocationId: actor.currentLocationId,
      state: absentActorState(actor.state),
      replaceCombatLifecycle: true,
      provenance: input.provenance,
      sessionId: input.sessionId,
      at: input.at,
    });
    return 'removed';
  });
}

/** Record the creature's own 0-hit-point rule (set by its owning effect). */
export function setCombatantZeroHpRule(
  db: Db,
  input: {
    readonly campaignId: string;
    readonly combatantId: string;
    readonly rule: ZeroHpRule;
    readonly provenance: string;
    readonly sessionId: string;
    readonly at: string;
  },
): void {
  withTransaction(db, (txn) => {
    const current = readCombatant(txn, input.campaignId, input.combatantId);
    if (current === undefined)
      throw new EncounterCombatantError(
        `unknown combatant '${input.combatantId}'`,
      );
    if (current.zeroHpRule === input.rule) return;
    txn
      .prepare(
        `UPDATE encounter_combatant SET zero_hp_rule=?, provenance=?, session_id=?, updated_at=?
         WHERE campaign_id=? AND combatant_id=?`,
      )
      .run(
        input.rule,
        input.provenance,
        input.sessionId,
        input.at,
        input.campaignId,
        input.combatantId,
      );
    assertCombatantLifecycle(txn, input.campaignId, input.combatantId, current);
    syncCombatantActor(txn, input.campaignId, input.combatantId, input);
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
  if (input.status === 'absent')
    throw new EncounterCombatantError(
      "status 'absent' is engine-owned: a creature leaves play through its owning effect or its zero-hit-point rule",
    );
  if (
    current.status === 'absent' &&
    (input.hpMax !== undefined ||
      input.hpDelta !== undefined ||
      input.clampToEffectiveMaximum === true ||
      input.addCondition !== undefined ||
      input.removeCondition !== undefined ||
      input.replaceConditions !== undefined ||
      input.status !== undefined ||
      input.deathRules !== undefined)
  )
    throw new EncounterCombatantError(
      `combatant '${input.combatantId}' is absent (out of play) and cannot be damaged, healed, given or relieved of conditions, or have its status changed`,
    );
  if (input.deathRules === 'player-character') {
    if (current.zeroHpRule !== null)
      throw new EncounterCombatantError(
        `cannot opt combatant '${input.combatantId}' into player-character death rules: its spell says it ${describeZeroHpRule(
          current.zeroHpRule,
        )} when it drops to 0 hit points (zero-hit-point rule)`,
      );
    const owner = findRemovePolicyActorLink(db, input.campaignId, {
      combatantId: current.combatantId,
      ...(current.identityKind === 'campaign_actor' &&
      current.identityRef !== undefined
        ? { actorId: current.identityRef }
        : {}),
    });
    if (owner !== undefined)
      throw new EncounterCombatantError(
        `cannot opt combatant '${input.combatantId}' into player-character death rules: effect '${owner.effectId}' owns it with a 'remove' cleanup policy and must be able to take it out of play, which a dying or stable creature cannot be`,
      );
  }
  // The creature record is needed only for HP changes (head loss and the
  // unknown-head refusal). Condition and participation writes — including
  // effect cleanup paths that may not carry the campaign resolver — read
  // head state from the row and never resolve the record.
  const currentMechanic =
    input.hpDelta === undefined
      ? undefined
      : multipleHeadsMechanic(
          lookupCampaignRecord(
            db,
            'creature',
            current.rulesRef,
            input.resolveRulesPack,
          ),
        );
  if (currentMechanic && current.headCount === null)
    throw new EncounterCombatantError(UNKNOWN_HEAD_STATE_MESSAGE);
  if (input.hpDelta !== undefined && !Number.isInteger(input.hpDelta)) {
    throw new EncounterCombatantError(
      'hpDelta must be an integer when provided',
    );
  }
  const previousHp = current.hpCurrent;
  const conditions = input.replaceConditions
    ? [...input.replaceConditions]
    : [...current.conditions];
  if (
    input.hpMax !== undefined &&
    (!Number.isInteger(input.hpMax) || input.hpMax < 0)
  )
    throw new EncounterCombatantError('hpMax must be a non-negative integer');
  const baseHpMax = input.hpMax ?? current.hpMax;
  const hpMax = effectiveHpMax(baseHpMax, conditions);
  const projectedHp = input.clampToEffectiveMaximum
    ? Math.min(current.hpCurrent, hpMax)
    : input.hpDelta === undefined
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
  const droppedToZero =
    input.hpDelta !== undefined && current.hpCurrent > 0 && projectedHp === 0;
  const deathRules = input.deathRules ? 'player-character' : current.deathRules;
  if (
    (input.status === 'dying' || input.status === 'stable') &&
    deathRules !== 'player-character'
  )
    throw new EncounterCombatantError(
      `status '${input.status}' requires deathRules 'player-character'`,
    );
  if (
    input.deathRules === 'player-character' &&
    current.hpCurrent === 0 &&
    current.status !== 'dead'
  )
    throw new EncounterCombatantError(
      'cannot opt a 0 HP combatant into player-character death rules unless it is dead; resolve its lifecycle first',
    );
  if (input.status === 'dying')
    throw new EncounterCombatantError(
      'a player-character combatant becomes dying through hpDelta, never an explicit status',
    );
  if (input.status === 'stable' && !droppedToZero)
    throw new EncounterCombatantError(
      "status 'stable' is accepted only as a knockout: with an hpDelta that reduces the combatant from above 0 to 0 hit points",
    );
  if (
    deathRules === 'player-character' &&
    (input.status === 'escaped' || input.status === 'inactive') &&
    input.hpDelta !== undefined
  )
    throw new EncounterCombatantError(
      'apply damage and participation status in separate calls under player-character death rules',
    );
  if (
    deathRules === 'player-character' &&
    (input.status === 'escaped' ||
      input.status === 'inactive' ||
      input.status === 'unconscious') &&
    (current.status !== 'alive' || projectedHp <= 0)
  )
    throw new EncounterCombatantError(
      `status '${input.status}' requires an alive player-character combatant with hit points above 0`,
    );

  // Default monster rules: damage to 0 with status 'unconscious' is a
  // nonlethal knockout, recognized before ordinary lethal damage.
  const monsterKnockout =
    input.status === 'unconscious' &&
    deathRules === 'monster' &&
    droppedToZero &&
    input.hpDelta !== undefined &&
    input.hpDelta < 0;
  const playerKnockout = input.status === 'stable' && droppedToZero;
  // A creature that disappears at 0 hit points has no status of its own to
  // take at 0 HP: the damage alone makes it absent. Refuse a status passed
  // with that damage up front, rather than failing later with a misleading
  // 'absent' refusal while the creature is still in play.
  if (
    (leavesPlayAtZeroHp(current.zeroHpRule) ||
      revertsFormAtZeroHp(current.zeroHpRule)) &&
    droppedToZero &&
    input.status !== undefined &&
    !(monsterKnockout || playerKnockout)
  )
    throw new EncounterCombatantError(
      `status '${input.status}' is refused with damage that brings combatant '${input.combatantId}' to 0 hit points: ` +
        `its spell says it ${describeZeroHpRule(current.zeroHpRule as ZeroHpRule)} at 0 hit points, so the damage alone settles it (${
          leavesPlayAtZeroHp(current.zeroHpRule)
            ? 'it leaves play, absent'
            : 'it returns to its natural form'
        }); pass the hpDelta without a status`,
    );
  if (
    current.zeroHpRule !== null &&
    droppedToZero &&
    (monsterKnockout || playerKnockout)
  )
    throw new EncounterCombatantError(
      `a knockout is refused for combatant '${input.combatantId}': its spell says it ${describeZeroHpRule(
        current.zeroHpRule,
      )} when it drops to 0 hit points (zero-hit-point rule)`,
    );
  let lifecycle = readCombatantLifecycleState(db, current);
  const oldExhaustion = exhaustionLevel(current.conditions);
  const nextExhaustion = exhaustionLevel(conditions);
  const nextEffectiveMax = effectiveHpMax(baseHpMax, conditions);
  let recoverySchedule: StableRecoverySchedule | undefined;
  const needsStableSchedule =
    playerKnockout || (lifecycle.stableRecoverySettled && nextEffectiveMax > 0);
  if (needsStableSchedule)
    recoverySchedule = newStableRecoverySchedule(
      db,
      input.rng ?? createSeededRng(0),
    );

  if (
    oldExhaustion !== nextExhaustion ||
    lifecycle.effectiveHpMax !== nextEffectiveMax ||
    current.hpMax !== baseHpMax
  ) {
    lifecycle = transitionCombatantLifecycle(
      lifecycle,
      {
        type: 'exhaustionChanged',
        newLevel: nextExhaustion,
        newEffectiveHpMax: nextEffectiveMax,
        newHpMax: baseHpMax,
      },
      recoverySchedule,
    );
  }
  if (input.deathRules === 'player-character') {
    lifecycle = transitionCombatantLifecycle(
      lifecycle,
      { type: 'optIntoPlayerCharacterRules' },
      recoverySchedule,
    );
  }

  let damageTurnKey: string | undefined;
  // Hit points the creature had when the damage event applied (after any
  // exhaustion clamp), for damage carried over to an original object form.
  let hpBeforeDamage = 0;
  if (
    input.hpDelta !== undefined &&
    input.hpDelta < 0 &&
    current.headCount !== null
  ) {
    const turn = db
      .prepare(`SELECT round_number, active_participant_kind, active_participant_ref
        FROM combat_instance WHERE campaign_id=? AND combat_instance_id=?`)
      .get(input.campaignId, current.combatInstanceId) as {
      round_number: number;
      active_participant_kind: string | null;
      active_participant_ref: string | null;
    };
    damageTurnKey = `${current.combatInstanceId}:${turn.round_number}:${turn.active_participant_kind ?? 'none'}:${turn.active_participant_ref ?? 'none'}`;
  }
  if (input.hpDelta !== undefined && input.hpDelta < 0) {
    const mechanic: CombatantHeadMechanic | undefined = currentMechanic
      ? {
          damageThreshold: currentMechanic.headDiesWhenDamageInOneTurnAtLeast,
          deathWhenNoHeads: currentMechanic.deathWhenNoHeads,
          regrowHeadsPerHead: currentMechanic.headsRegrownPerDeadHead,
          hpPerHead: currentMechanic.hitPointsPerRegrownHead,
          regrowthSuppressedByFire:
            currentMechanic.regrowthSuppressedByDamageType === 'fire',
        }
      : undefined;
    hpBeforeDamage = lifecycle.hpCurrent;
    lifecycle = transitionCombatantLifecycle(
      lifecycle,
      playerKnockout || monsterKnockout
        ? {
            type: 'knockout',
            damage: -input.hpDelta,
            damageTypes: input.damageTypes,
            turnKey: damageTurnKey,
            headMechanic: mechanic,
          }
        : {
            type: 'damage',
            amount: -input.hpDelta,
            critical: input.critical,
            damageTypes: input.damageTypes,
            turnKey: damageTurnKey,
            headMechanic: mechanic,
          },
      recoverySchedule,
    );
  } else if (input.hpDelta !== undefined && input.hpDelta > 0) {
    lifecycle = transitionCombatantLifecycle(
      lifecycle,
      { type: 'heal', amount: input.hpDelta },
      recoverySchedule,
    );
  } else if (input.clampToEffectiveMaximum) {
    lifecycle = transitionCombatantLifecycle(
      lifecycle,
      { type: 'clampToEffectiveMax' },
      recoverySchedule,
    );
  }
  if (
    input.status !== undefined &&
    input.status !== 'stable' &&
    !monsterKnockout &&
    input.status !== lifecycle.status
  ) {
    lifecycle = transitionCombatantLifecycle(
      lifecycle,
      { type: 'setStatus', status: input.status },
      recoverySchedule,
    );
  }
  if (
    lifecycle.status === 'stable' &&
    lifecycle.stableRecovery === null &&
    !lifecycle.stableRecoverySettled
  )
    throw new EncounterCombatantError(
      'stable status requires a complete recovery schedule or settled recovery',
    );
  const nextHp = lifecycle.hpCurrent;
  const status = lifecycle.status;
  const headCount = lifecycle.headCount;
  const headsDiedSinceOwnTurn = lifecycle.headsDiedSinceOwnTurn;
  const fireDamageSinceOwnTurn = lifecycle.fireDamageSinceOwnTurn;
  const damageThisTurn = lifecycle.damageThisTurn;
  const damageTurnKeyNext = lifecycle.damageTurnKey;
  const headDiedThisTurn = lifecycle.headDiedThisTurn;
  const successes = lifecycle.deathSaveSuccesses;
  const failures = lifecycle.deathSaveFailures;
  const recoveryBlock = lifecycle.recoveryBlock;
  const recoveryRoll = lifecycle.stableRecovery?.roll ?? null;
  const recoveryAnchor = lifecycle.stableRecovery?.anchor ?? null;
  const recoveryDeadline = lifecycle.stableRecovery?.deadline ?? null;
  const deathRulesNext = lifecycle.deathRules;
  const stableRecoverySettled = lifecycle.stableRecoverySettled ? 1 : 0;
  const locationId = input.locationId ?? current.locationId;
  const placement = input.placement ?? current.placement;

  db.prepare(
    `UPDATE encounter_combatant
     SET hp_current = ?, hp_max = ?, conditions_json = ?, status = ?, location_id = ?,
         head_count = ?, heads_died_since_own_turn = ?,
         fire_damage_since_own_turn = ?, damage_this_turn = ?,
         damage_turn_key = ?, head_died_this_turn = ?,
         death_rules = ?, death_save_successes = ?, death_save_failures = ?,
         recovery_block = ?, stable_recovery_roll = ?,
         stable_recovery_anchor_elapsed_minutes = ?, stable_recovery_deadline_elapsed_minutes = ?,
         stable_recovery_settled = ?,
         placement = ?, provenance = ?, session_id = ?, updated_at = ?
     WHERE campaign_id = ? AND combatant_id = ?`,
  ).run(
    nextHp,
    lifecycle.hpMax,
    JSON.stringify(conditions),
    status,
    locationId ?? null,
    headCount,
    headsDiedSinceOwnTurn,
    fireDamageSinceOwnTurn,
    damageThisTurn,
    damageTurnKeyNext,
    headDiedThisTurn,
    deathRulesNext,
    successes,
    failures,
    recoveryBlock,
    recoveryRoll,
    recoveryAnchor,
    recoveryDeadline,
    stableRecoverySettled,
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
  // Zero-hit-point 'revert-form' (same transaction): the creature returns to
  // the natural form recorded at cast and stays in play, before anything
  // reacts to the transient 0 hit points.
  let reverted: RevertedOutcome | undefined;
  if (
    revertsFormAtZeroHp(current.zeroHpRule) &&
    current.hpCurrent > 0 &&
    nextHp === 0 &&
    status !== 'dead'
  ) {
    const atZero = readCombatant(db, input.campaignId, input.combatantId);
    if (atZero === undefined)
      throw new EncounterCombatantError('combatant disappeared during update');
    reverted = completeZeroHpFormReversion(db, atZero, input);
  }
  const settled =
    reverted === undefined
      ? { hp: nextHp, status }
      : (() => {
          const row = readCombatant(db, input.campaignId, input.combatantId);
          return {
            hp: row?.hpCurrent ?? nextHp,
            status: row?.status ?? status,
          };
        })();
  assertCombatantLifecycle(db, input.campaignId, input.combatantId, current);

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
    current.status === 'inactive' ||
    current.status === 'absent';
  const isDown =
    settled.hp === 0 ||
    settled.status === 'dead' ||
    settled.status === 'unconscious' ||
    settled.status === 'dying' ||
    settled.status === 'stable' ||
    settled.status === 'inactive' ||
    settled.status === 'absent';
  const wasIncapacitated =
    wasDown ||
    anyConditionImpliesIncapacitated(
      db,
      current.conditions.map((c) => c.id),
      input.resolveRulesPack,
    );
  const isIncapacitated =
    isDown ||
    anyConditionImpliesIncapacitated(
      db,
      conditions.map((c) => c.id),
      input.resolveRulesPack,
    );
  let concentrationBroken: UpdateCombatantResult['concentrationBroken'];
  if (!wasIncapacitated && isIncapacitated) {
    const broken = breakCombatantConcentration(
      db,
      input.campaignId,
      input.combatantId,
      status === 'dead'
        ? 'dead'
        : status === 'inactive' || status === 'absent'
          ? 'owner-removed'
          : 'incapacitated',
      {
        provenance: input.provenance,
        sessionId: input.sessionId,
        at: input.at,
        ...(input.resolveRulesPack === undefined
          ? {}
          : { resolveRulesPack: input.resolveRulesPack }),
      },
    );
    if (broken.broken && broken.effectId !== undefined) {
      concentrationBroken = {
        effectId: broken.effectId,
        displayName: broken.displayName ?? broken.effectId,
        cause:
          status === 'dead'
            ? 'dead'
            : status === 'inactive' || status === 'absent'
              ? 'owner-removed'
              : 'incapacitated',
      };
    }
  }

  // Zero-hit-point 'vanish' / 'revert-object' aftermath (same transaction):
  // the creature's spell link closes with reason zero-hit-points, and the
  // effect ends with source-removed when that was its last owned creature.
  // An animated object's damage beyond 0 carries over to its object form.
  let vanished: VanishedOutcome | undefined;
  if (current.status !== 'absent' && status === 'absent') {
    if (current.zeroHpRule === 'revert-object')
      reverted = completeZeroHpObjectReversion(
        db,
        current,
        input.hpDelta !== undefined && input.hpDelta < 0 && hpBeforeDamage > 0
          ? Math.max(0, -input.hpDelta - hpBeforeDamage)
          : 0,
        input,
      );
    else vanished = completeZeroHpVanish(db, current, input);
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
    ...(vanished === undefined ? {} : { vanished }),
    ...(reverted === undefined ? {} : { reverted }),
  };
}
